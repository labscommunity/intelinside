# Intelinside agent API

Use this API to act on behalf of an Intelinside user with their personal API key.
Base URL: `https://www.intelinside.ai/api/v1`.
Interactive account setup: `https://www.intelinside.ai/settings/api-keys`.
Machine-readable reference: `https://www.intelinside.ai/api/openapi.json`.

## Set up once

The user signs in, creates a named key in **Account menu → API keys**, and saves it
as `INTELINSIDE_API_KEY` in the agent's environment or secret settings. The key is
shown once. It can be revoked at any time. Do not ask for GitHub credentials or a
Supabase project key. Never print the personal key, include it in a URL, commit it,
or send it to an unrelated host. Use it only in the Authorization header:

```sh
curl --fail-with-body https://www.intelinside.ai/api/v1/me \
  -H "Authorization: Bearer $INTELINSIDE_API_KEY"
```

Keys can have `read`, `write`, and `community` permissions. Full user access includes
all three. `write` manages the user's own rigs, custom runtimes, results, and rig
photos. `community` can confirm or flag other users' results. Keys cannot manage
other keys. Account creation and key settings require the user's signed-in session.
Model, hardware, base runtime, and quantization catalog changes still require a
maintainer-reviewed repository change. Do not substitute an unrelated catalog ID.

## Find or create the prerequisites

1. Read `GET /me` to identify the user and permissions.
2. Read `GET /catalog` for hardware, model, quantization, and base runtime IDs.
3. Read `GET /rigs?owner=me` and `GET /custom-runtimes?owner=me` before creating
   records. Follow `nextCursor` by passing it as `cursor` until absent.
4. Create missing rigs and builds, then submit results referencing their returned
   string IDs. A result must use a rig owned by the authenticated user. A public
   custom build may belong to another user, but its base runtime must match.
5. Return the resulting records' page URLs to the user. Relative `url` values are
   relative to the Intelinside origin.

Public profile lookup: `GET /users/{handle}`. Use its `id` for an `owner` filter;
`owner=me` selects the authenticated user. Lists default to 25 records, allow
`limit=1` through `100`, and return `{ "items": [...], "nextCursor": "..." }`.
Available filters: `q` (name or notes), `owner` (user UUID or `me`), `rig`, `model`,
`runtime`, and `hardware`. Use filters only on applicable resource types:
`rig` and `model` apply to results; `runtime` applies to results and custom runtimes;
`hardware` applies to rigs and component results. IDs are case-sensitive.

## Writes and retries

Send JSON with `Content-Type: application/json`. All writes require an
`Idempotency-Key`: a unique string of 1–128 printable non-space ASCII characters
identifying the logical operation. Save it before the request. On a network error,
timeout, or 5xx, retry the **same method, URL, body, version, and key**. Do not retry
with a fresh key: that could create a duplicate. Identical committed operations
return the original response; using the same key for different input returns 409.
Receipts last 30 days and are shared across the user's keys. After that, check for
existing records before attempting an old operation again. Failed operations that
rolled back have no receipt and can be corrected and retried.

PATCH and record DELETE also require `If-Match: "<updatedAt>"`, using the timestamp
from the latest GET response. PATCH only changes supplied fields; `null` clears
nullable fields. A stale timestamp returns 412: fetch the record and reconcile the
change before retrying with a new idempotency key. Deleting a rig that has results
requires `?cascade=true`, which deletes those results too. Deleting a custom
runtime referenced by results returns 409. Confirmations and flags use PUT/DELETE
rather than toggle semantics, so repeated requests cannot undo the desired state.

Every successful write returns JSON, including DELETE. Created records and batches
return 201; other successful operations return 200. IDs are strings; dates use
`YYYY-MM-DD`; timestamps use ISO 8601. Record responses include `id`, `updatedAt`,
ownership, resource fields, and `url`. Rig responses include `components`. Responses
for optional fields can contain `null`. Result metrics use tokens per second and
milliseconds (`ttftMs`). Standard database verification and moderation rules apply;
API submission does not grant verification or a maintainer endorsement.

## Example: fleet → build → result

These are illustrative API calls. Replace the catalog IDs and measurements with
values from the actual run. Never invent benchmark numbers. Evidence is optional;
when available, `repoUrl` accepts an absolute HTTPS evidence link.

```sh
curl --fail-with-body https://www.intelinside.ai/api/v1/rigs \
  -H "Authorization: Bearer $INTELINSIDE_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: fleet-registration-2026-09-27' \
  --data '{"name":"Panther Lake Lab","os":"Linux","components":[{"hardwareId":"intel-core-ultra-x7-358h","quantity":11},{"hardwareId":"intel-arc-b390","quantity":11}]}'
```

List each hardware ID once, with its quantity. For integrated GPUs and NPUs, include
the host CPU; their quantities are normalized to the total count of matching CPUs.

```sh
curl --fail-with-body https://www.intelinside.ai/api/v1/custom-runtimes \
  -H "Authorization: Bearer $INTELINSIDE_API_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: custom-runtime-registration-2026-09-27' \
  --data '{"runtimeId":"llamacpp","name":"My experimental build","repoUrl":"https://github.com/example/runtime","summary":"Describe what changed"}'
```

Use returned IDs as `rigId` and `customRuntimeId`. Use the base runtime's ID for
`runtimeId`, and an exact commit/tag/build ID for `revision` when known. Omit
`customRuntimeId` and `revision` for stock runs. For a component result, supply
`componentId` and `componentQuantity` (defaults to 1). The component must be in the
rig, and its quantity cannot exceed the rig's quantity.

```json
{
  "rigId": "REPLACE_WITH_RIG_ID",
  "modelId": "qwen3-8b",
  "quant": "q4_k_m",
  "runtimeId": "llamacpp",
  "runtimeVersion": "REPLACE_WITH_VERSION",
  "customRuntimeId": "REPLACE_WITH_BUILD_ID",
  "revision": "REPLACE_WITH_COMMIT",
  "decodeTps": 34.2,
  "runDate": "2026-09-27"
}
```

POST that object to `/results`, or POST `{ "items": [ ... ] }` to `/results/batch`
for up to 100 results in one transaction. If one entry fails, none are committed.
Record workload, concurrency, speculation, and other comparability caveats in
`runtimeFlags` and `notes`. Publishing measured aggregate throughput as a single
stream measurement would misrepresent the run.

## Rig photos

1. POST `/uploads` with `{ "contentType": "image/png", "size": 12345 }` and an
   idempotency key. Maximum size is 10 MiB; JPEG, PNG, WebP, and GIF are supported.
2. PUT the file bytes to the returned `uploadUrl`, with the declared Content-Type.
   This is a signed Supabase Storage URL. **Do not send your Intelinside API key
   to that URL.** The URL permits upload only to the newly reserved object path,
   does not permit overwrite, and expires after two hours. Treat it as a secret.
3. POST `/uploads/complete` with `{ "photoPath": "<returned photoPath>" }` and a
   separate idempotency key. The server verifies the stored size/type and ownership.
4. Set the rig's `photoPath` to that returned path, using PATCH and If-Match. Set
   `photoPath` to null to remove a photo from a rig.

If the upload response is lost, attempt completion first. If the object is absent,
retry allocation with the same idempotency key to obtain a fresh signed URL. If
completion says the object has the wrong type/size, allocate a new path. Revoking a
key blocks further API operations; a previously issued upload URL stays valid for
its remaining two-hour lifetime but cannot attach the image to a rig by itself.

## Errors and limits

Errors are JSON: `{ "error": { "code": "...", "message": "...", "fields": { ... } } }`.
`fields` is optional and identifies invalid request fields. Unknown fields are
rejected; do not send ownership, verification, moderation, or PR provenance fields.

- 400: invalid input; fix the supplied fields.
- 401: missing, invalid, expired, or revoked key; ask the user to update the secret.
- 403: insufficient permission or an operation the user cannot perform.
- 404: record/route not found, or a write to content not owned by this user.
- 409: idempotency conflict, catalog/reference conflict, or deletion requiring cascade.
- 412: stale record version; read again and reconcile.
- 413: JSON body exceeds 1 MiB; split result batches or use signed photo uploads.
- 415: request body must be JSON.
- 428: If-Match is required for this edit or deletion.
- 429: account limit of 120 authenticated requests per minute; respect Retry-After.
- 5xx: service unavailable; retry with backoff and the same idempotency key.

Key settings allow up to 20 active keys per account. Public catalog access needs no
key. No SDK, MCP server, or additional paid integration is required.


## Routes

All paths below are relative to `/api/v1`. Every route except `/catalog` requires a personal API key.

| Method | Path | Permission | Behavior |
| --- | --- | --- | --- |
| GET | `/catalog` | public | Hardware, models with supported quant IDs, quantizations, and base runtimes. Public; no key required. |
| GET | `/me` | read | Your profile, key ID, and granted permissions. |
| GET | `/users/{handle}` | read | Read a public profile. |
| GET | `/rigs` | read | List rigs. Filter by owner=me, q, or resource-specific IDs. |
| GET | `/rigs/{id}` | read | Read one record and its current updatedAt version. |
| POST | `/rigs` | write | Create a record owned by the authenticated user. |
| PATCH | `/rigs/{id}` | write | Update your record. Requires If-Match with its updatedAt value. |
| DELETE | `/rigs/{id}` | write | Delete your record. Requires If-Match. Rig deletion with results also requires cascade=true. |
| GET | `/custom-runtimes` | read | List custom-runtimes. Filter by owner=me, q, or resource-specific IDs. |
| GET | `/custom-runtimes/{id}` | read | Read one record and its current updatedAt version. |
| POST | `/custom-runtimes` | write | Create a record owned by the authenticated user. |
| PATCH | `/custom-runtimes/{id}` | write | Update your record. Requires If-Match with its updatedAt value. |
| DELETE | `/custom-runtimes/{id}` | write | Delete your record. Requires If-Match. Rig deletion with results also requires cascade=true. |
| POST | `/results/batch` | write | Create up to 100 results atomically. A failure rolls back the entire batch. |
| GET | `/results` | read | List results. Filter by owner=me, q, or resource-specific IDs. |
| GET | `/results/{id}` | read | Read one record and its current updatedAt version. |
| POST | `/results` | write | Create a record owned by the authenticated user. |
| PATCH | `/results/{id}` | write | Update your record. Requires If-Match with its updatedAt value. |
| DELETE | `/results/{id}` | write | Delete your record. Requires If-Match. Rig deletion with results also requires cascade=true. |
| PUT | `/results/{id}/confirmation` | community | Confirm another user’s result. Repeating this never removes a confirmation. |
| DELETE | `/results/{id}/confirmation` | community | Remove your confirmation. |
| PUT | `/results/{id}/flag` | community | Set or replace your flag on another user’s result. |
| DELETE | `/results/{id}/flag` | community | Remove your flag. |
| POST | `/uploads` | write | Reserve a rig photo and obtain a signed upload URL. PUT the image bytes there, then complete the upload. |
| POST | `/uploads/complete` | write | Verify an uploaded photo and return its photoPath for a rig. |

### Input: POST /rigs

Unknown fields are rejected. PATCH accepts the same fields as POST, all optional.

| Field | Required on create | Type and limits |
| --- | --- | --- |
| `name` | Yes | string; max 120 characters |
| `os` | No | string; max 120 characters |
| `notes` | No | string or null; max 5000 characters |
| `photoPath` | No | string or null; max 250 characters |
| `components` | Yes | array; 1–100 items |

Each component is `{ "hardwareId": "<catalog ID>", "quantity": 11 }`; quantity is an integer from 1 to 32767.

### Input: POST /custom-runtimes

Unknown fields are rejected. PATCH accepts the same fields as POST, all optional.

| Field | Required on create | Type and limits |
| --- | --- | --- |
| `runtimeId` | Yes | string; max 120 characters |
| `name` | Yes | string; max 120 characters |
| `repoUrl` | Yes | string (http-url); max 2048 characters |
| `summary` | Yes | string; max 280 characters |
| `notes` | No | string or null; max 5000 characters |

### Input: POST /results/batch

Unknown fields are rejected. PATCH accepts the same fields as POST, all optional.

| Field | Required on create | Type and limits |
| --- | --- | --- |
| `items` | Yes | array; 1–100 items |

Each item uses the POST /results fields below.

### Input: POST /results

Unknown fields are rejected. PATCH accepts the same fields as POST, all optional.

| Field | Required on create | Type and limits |
| --- | --- | --- |
| `rigId` | Yes | string |
| `modelId` | Yes | string; max 120 characters |
| `quant` | Yes | string; max 120 characters |
| `runtimeId` | Yes | string; max 120 characters |
| `runtimeVersion` | Yes | string; max 80 characters |
| `runtimeFlags` | No | string or null; max 200 characters |
| `customRuntimeId` | No | string or null |
| `revision` | No | string or null; max 80 characters |
| `componentId` | No | string or null; max 120 characters |
| `componentQuantity` | No | integer or null; minimum 1; maximum 32767 |
| `decodeTps` | Yes | number; greater than 0; maximum 1000000000000 |
| `promptTps` | No | number or null; greater than 0; maximum 1000000000000 |
| `ttftMs` | No | number or null; greater than 0; maximum 1000000000000 |
| `contextLength` | No | integer or null; minimum 1; maximum 2147483647 |
| `batchSize` | No | integer or null; minimum 1; maximum 2147483647 |
| `notes` | No | string or null; max 5000 characters |
| `repoUrl` | No | string or null (https-url); max 2048 characters |
| `runDate` | Yes | string (date) |

### Input: PUT /results/{id}/flag

Unknown fields are rejected. PATCH accepts the same fields as POST, all optional.

| Field | Required on create | Type and limits |
| --- | --- | --- |
| `reason` | Yes | string: implausible, wrong_hardware, duplicate, spam, other |
| `note` | No | string or null; max 5000 characters |

### Input: POST /uploads

Unknown fields are rejected. PATCH accepts the same fields as POST, all optional.

| Field | Required on create | Type and limits |
| --- | --- | --- |
| `contentType` | Yes | string: image/jpeg, image/png, image/webp, image/gif |
| `size` | Yes | integer; minimum 1; maximum 10485760 |

### Input: POST /uploads/complete

Unknown fields are rejected. PATCH accepts the same fields as POST, all optional.

| Field | Required on create | Type and limits |
| --- | --- | --- |
| `photoPath` | Yes | string; max 250 characters |
