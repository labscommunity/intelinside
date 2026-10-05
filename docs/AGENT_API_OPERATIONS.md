# Personal API keys: deployment and review

The HTTP API uses the existing Vercel deployment and Supabase project. There is no
new hosted service. Users create personal keys at `/settings/api-keys` and use
`/docs/agents.md`; `/api/openapi.json` is generated at request time from the same
route schemas used for validation. `docs/API.md` describes the older frontend
adapter contract, not these versioned HTTP routes.

## Deployment order

1. Apply `supabase/migrations/20261003120000_personal_api_keys.sql` using the normal
   migration workflow. It adds private key, receipt, activity, limit, and upload
   tables; service-only RPCs; and a NOLOGIN/NOBYPASSRLS executor role.
2. Set `SUPABASE_URL` (or reuse `VITE_SUPABASE_URL`) and **server-only**
   `SUPABASE_SECRET_KEY` in the Vercel deployment. Legacy
   `SUPABASE_SERVICE_ROLE_KEY` is supported as a fallback. Never prefix the secret
   with `VITE_` or put it in browser configuration. Existing public browser auth
   variables remain required for the settings page.
3. Deploy the frontend/API. Missing server configuration returns 503; it cannot
   silently create an unauthenticated API. This PR does not alter production
   database state or deployment secrets.
4. In a staging project, sign in, create a key, call `/api/v1/me`, create a disposable
   rig, upload/attach a photo, and revoke the key. Confirm the next request is 401.
   Local tests cover the app and database but emulate hosted Auth/Storage services.

Roll back the application deployment first if needed. Disabling the server secret
stops new API requests without changing browser-based content access. Revoke keys
if withdrawing the feature. Already issued signed upload URLs expire within two
hours; they allow only a new reserved object and cannot attach it after revocation.

## Authorization boundary

The HTTP handler verifies browser sessions with Supabase Auth for key management.
Personal keys cannot manage keys. Secrets use 32 cryptographically random bytes;
Postgres stores SHA-256 hashes, prefixes, and metadata. Hashes are suitable here
because these are high-entropy random tokens, not user passwords.

`public.agent_request` is executable only by service_role. It checks key validity,
permissions, per-account rate limits, and retry receipts. It sets the user identity
only for the operation, then calls `private.agent_dispatch`, owned by the limited
`intelinside_agent` role, which inherits the same table grants and RLS policies as
an authenticated browser. The dispatcher accepts only named operations and
allowlisted fields; it never accepts arbitrary SQL or caller-supplied identity.
Do not change its owner to postgres/service_role. Public browser roles cannot
execute either privileged entry point or inspect private token tables.

Mutation, audit entry, and receipt commit in one database transaction. The account
limit row serializes operations across the user's keys, preventing concurrent
requests from claiming the same idempotency key. Revocation locks the key row, so
it takes effect for operations authorized after revocation. Request identity is
restored on success and rolled back on exceptions. Activity stores operation names
and record IDs; it does not store request bodies or raw keys. Retry receipts retain
request/response data for 30 days; activity retains 90 days. Cleanup happens lazily
on the next authenticated request for that account.

Signed Storage uploads have no owner_id when issued by the service role. A private
allocation receipt ties the random object path to the authenticated user, and
completion checks object metadata before the existing rig-photo trigger accepts
that path. No external URL is fetched and no Storage metadata is modified directly.

API text moderation reuses the browser's validator. Existing table constraints,
result verification triggers, and RLS remain in effect. Agent photos use the same
10 MiB/type limits as the website. Native personal keys are accepted only by this
API, never directly by Supabase's table or Storage endpoints.

## Reproduce validation

```sh
npm ci --prefix frontend
npm --prefix frontend run typecheck
npm --prefix frontend run results:test
npm --prefix frontend run agents:docs:check
npm --prefix frontend exec -- playwright install chromium
npm --prefix frontend run agents:e2e
npm --prefix frontend run build
```

`agents:test` uses the real HTTP handler and all migrations in PGlite (Postgres
compiled to WASM), including RLS and role grants. Hosted Auth verification and
Storage transport are local stand-ins. `agents:e2e` drives the browser settings
page against that HTTP server/database, then uses the newly minted key to register
hardware, a custom runtime, and measurements and verifies revocation.

An additional `npm run agents:postgres` check creates a disposable native PostgreSQL
cluster, applies every migration as a non-superuser with CREATEROLE/BYPASSRLS, and
exercises the executor, retries, and access grants. Set `PG_BINDIR` to your Postgres
binary directory if it is not `/opt/homebrew/opt/postgresql@17/bin`. It never uses an
existing database.

Tests run on pull requests and upload browser traces/screenshots on failure.
For an interactive local session, `npm run agents:dev` (inside frontend) starts the
isolated fixture backend on 8080 and Vite on 5173. Test accounts and secrets exist
only in that process; no production credentials are used. See the browser test
fixture for how it seeds a local browser session.

Edit the introductory docs in `docs/AGENTS_API_INTRO.md`, route/schema definitions
in `frontend/src/agent-api/contract.ts`, then run `npm run agents:docs`. Commit the
generated `frontend/public/docs/agents.md`. CI checks that it stays current.
