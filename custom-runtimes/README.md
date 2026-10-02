# Custom runtimes by pull request

Sign up on the site once using GitHub, then add a new file at
`custom-runtimes/<your-github-handle>/<name>.json` and open a PR against `main`:

```json
{
  "$schema": "https://raw.githubusercontent.com/labscommunity/intelinside/main/custom-runtimes/schema.json",
  "runtime": "llamacpp",
  "name": "PrismML llama.cpp",
  "repoUrl": "https://github.com/PrismML-Eng/llama.cpp",
  "summary": "PrismML fork adding Bonsai low-bit formats and inference support.",
  "notes": "Optional build instructions and upstream attribution."
}
```

No benchmark, rig, registration form, or personal API key is required. Ownership
means maintaining this entry, not authorship of upstream code. The verified numeric
GitHub ID of the PR author determines ownership, even when a maintainer pushes fixes.
Do not include owner IDs, GitHub IDs, or other attribution fields.

The base runtime must already exist in the catalog and database. Name (1–120),
summary (1–280), and a full HTTP(S) source URL without credentials are required.
Notes are optional (1–5,000 characters when supplied). Text is trimmed, cannot be
blank, and uses the existing text moderation. Unknown fields are rejected.
Use letters, digits, dots, underscores, or hyphens for the filename, starting with
a letter or digit. The directory must match the PR author's GitHub login.

The **Result ingestion** check validates registrations and results in a rolled-back
database transaction. Merge creates the entire batch atomically and reports IDs
and public URLs. Closing without merging writes nothing. The combined limit is
100 registration/result files per PR, each at most 64 KiB. Validation is a snapshot;
merge checks current database state again.

## Results in the same PR

A result can reference a registration added in that PR:

```json
{
  "runtime": "llamacpp",
  "customRuntimeFile": "custom-runtimes/alice/prismml-llamacpp.json",
  "revision": "exact-commit-tag-or-build-id"
}
```

This is a fragment of a [result file](../results/README.md). Include its other
required fields. `customRuntimeFile` and `customRuntime` are mutually exclusive;
the base runtimes must match. Paths outside this PR and traversal are rejected.
In later PRs use the returned numeric ID as `customRuntime`. Exact registered
names and other users' runtimes still work. Revisions belong to results, not registrations.

## Existing entries and retries

A matching source/base-runtime pair blocks creation and reports candidate IDs.
Reuse one or ask a maintainer to resolve the duplicate explicitly. Source matching
lowercases the scheme and authority, strips trailing slashes and a terminal `.git`,
and preserves path case, query, fragment, and HTTP versus HTTPS. This conservative
policy does not infer redirects or repository aliases.

Each imported path is permanently consumed. Identical retries of the original PR
return the same ID; changed payloads or different PRs cannot reuse that path.
Receipts survive deletion, so retrying cannot resurrect a deleted registration.
Edits and renames cannot update or recreate entries; removal does not delete them.
Use the existing owner UI/API for subsequent edits. The detail page displays the
trusted submission PR separately from the upstream source URL.

Maintainers: see [deployment requirements](../docs/SUPABASE.md#results-submitted-through-prs).
