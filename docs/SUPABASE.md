# Supabase production project

This repository uses one hosted Supabase project in the `CLabs` organization:

| Environment | Project | Project ref | Region |
| --- | --- | --- | --- |
| Production | `intelinside` | `ujlacyedspjfekotemmd` | `us-east-1` |

This is the live production database, including when accessed from local development.
There is no configured staging project or hosted reset command.

## Frontend selection

- `npm run dev` uses `frontend/.env`. Its configured Supabase project is production.
- `npm run build` uses `frontend/.env.production.local` when it is present.
- Hosted deployments should set `VITE_SUPABASE_URL` to
  `https://ujlacyedspjfekotemmd.supabase.co` and `VITE_SUPABASE_PUBLISHABLE_KEY`
  to that project's browser-safe key.
- Use `VITE_API_MODE=mock` for isolated offline development, or `supabase` to
  access the production database. Do not run destructive tests against production.

Only the publishable key belongs in a Vite environment variable. Never put a
Supabase secret or service-role key in a `VITE_*` variable.

Rig writes call the authenticated `create_rig` and `update_rig` database
functions so the rig and its component rows are changed atomically. Browser result
writes use the Supabase table API directly. RLS enforces ownership for both.
Text length and profanity checks run in the browser and trusted PR ingestion
script; they are not a database-enforced security boundary.

## Intermittent first-load JWT errors

`PGRST303: JWT issued at future` can come from PostgREST's cached server clock,
even with a valid token. The upstream fix shipped in PostgREST 14.18 and 16.3
([fix](https://github.com/PostgREST/postgrest/pull/5208),
[releases](https://github.com/PostgREST/postgrest/blob/main/CHANGELOG.md)).
For hosted production, use Supabase's official managed upgrade when available.
Their [September 17 incident update](https://supabase.statuspage.io/incidents/6q5902p2xd9f)
says affected projects will need a dashboard upgrade once the new Supabase version
is released. Confirm availability for the project with Supabase; a custom
PostgREST build is not required. The production version has not been verified.

The browser retries only REST GET requests that return HTTP 401 with that exact
code and message, waiting 250, 750, then 1500 ms. Persistent failures still reach
the page's error state. This mitigates transient failures without refreshing
tokens, clearing sessions, or replaying writes; it does not fix the server clock.

## Database changes

Migrations live in `supabase/migrations/`. Test locally with
`npm --prefix frontend run results:test`, then review pending production migrations:

```sh
npm --prefix frontend run supabase:db:push:prod:dry-run
```

Once the pending changes have been reviewed and production deployment is authorized:

```sh
npm --prefix frontend run supabase:db:push:prod
```

Both commands explicitly target `ujlacyedspjfekotemmd` and skip unrelated Vault
updates. There is no production reset script. Never treat this project as disposable.

## GitHub OAuth

Register this Supabase callback URL in the GitHub OAuth app:

`https://ujlacyedspjfekotemmd.supabase.co/auth/v1/callback`

Store the GitHub client secret in Supabase Auth configuration, never in the
React application or repository. Configure the production site URL and allowed
redirect URLs in Supabase Auth.

For local development using production OAuth, allow-list
`http://localhost:5173/auth/callback` (or the equivalent `127.0.0.1` URL).
Vite is pinned to port 5173 so it fails clearly instead of silently choosing a
port that Supabase has not allow-listed. Local sign-in still accesses production data.

## Results submitted through PRs

Apply `20260908120000_ingest_pr_results.sql` to the target database before enabling
`.github/workflows/validate-results.yml`. Configure these GitHub Actions settings:

- Repository variable `SUPABASE_URL`: the target project's URL (production for the public repo).
- Repository secret `SUPABASE_SERVICE_ROLE_KEY`: that project's server-side service-role key.
- Repository variable `SITE_URL`: the matching site URL, used for signup links.

Require the **Result ingestion** commit status in the `main` branch ruleset. It
runs for every PR, including PRs without results, so a required status is never
missing due to path filters. The workflow itself must be on the default branch
before it can validate contributor PRs. A maintainer can use **Run workflow**
with a PR number to recheck after signup or retry ingestion after merge.

The privileged workflow uses `pull_request_target`, checks out only the default
branch, and never executes PR code or installs PR dependencies. It downloads
bounded JSON files at the head SHA for validation and the merge SHA for ingestion.
Do not change checkout to the PR head, download executable artifacts from PR CI,
or expose the server key to a browser build. Protect changes to this workflow,
its scripts, and database migrations through normal maintainer review.

`ingest_pr_results` is executable only by `service_role`. It joins the PR author's
numeric GitHub ID to `auth.identities(provider = 'github', provider_id)` and then
`profiles.auth_user_id`; profile handles and editable user metadata are never
identity proofs. An account without a linked GitHub identity fails with signup
instructions. Existing OAuth identities work without a profile backfill.

Validation runs the same database inserts and constraints as ingestion, then
rolls back the subtransaction. It leaves no results or receipts, although PostgreSQL
identity sequences can have gaps. Merge inserts the batch atomically and keeps
private receipts keyed by repository and filename. Retries of the same PR/payload
return the existing IDs. Receipts survive deleted results to prevent resurrection.
Different PRs or changed payloads cannot overwrite an imported path. JSON containing
`result` is an archive and never writes a result row. File removal does not delete
live rows. Previously submitted legacy PR evidence is detected to avoid reimporting it.

Result evidence is optional. `results.repo_url` retains its storage name but accepts
any full HTTPS URL or NULL. The web/API field is `repoUrl`; PR JSON uses `evidenceUrl`.
PR ingestion stores the submission link separately in `source_pr_url`, which browser
roles can read but cannot write. The optional-evidence migration backfills that link
from existing import receipts without changing evidence, verification, or edit timestamps.
Apply `20260918090000_optional_result_evidence.sql` before deploying the updated frontend
and PR parser. An omitted link on create is stored as NULL; clearing it on edit sends NULL.

Rig registration and custom-runtime registration remain site operations. Referenced
catalog entries must already exist in both the trusted default-branch catalog and
the target database; merge/deploy catalog additions before submitting runs that use them.

The configured project is production. Use the isolated local ingestion tests for
validation before deploying migrations. A live integration test requires an
explicitly intended benchmark submission from a real GitHub OAuth account and
owned rig; do not use production as a disposable test database.

Run `npm --prefix frontend run results:test` for the local ingestion tests. They
load the application migrations into an isolated PGlite PostgreSQL instance with
a minimal Auth schema, then verify identity attribution, permissions, ownership,
rollback, archives, retries, and the GitHub file-loading flow. They do not contact
hosted Supabase or GitHub. Storage-specific migrations are outside this test scope.
