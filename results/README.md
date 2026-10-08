# Results by pull request

Every result on the site can also live here as a file, and a file here can become a result on the site. Two directions, one format.

## Add a result from a file

1. Sign in on the site once so your GitHub handle has a profile, and register the rig you ran on. The rig's URL ends in a number; that number (or the rig's exact name) goes in the file. Open the PR using this same GitHub account; an agent can use your authenticated GitHub CLI session. Bot-authored PRs cannot be attributed to your account.
2. Add `results/<your-github-handle>/<name>.json`:

   ```json
   {
     "$schema": "https://raw.githubusercontent.com/labscommunity/intelinside/main/results/schema.json",
     "rig": "12",
     "component": "intel-arc-b580",
     "componentQuantity": 1,
     "model": "qwen3-8b",
     "quant": "q4_k_m",
     "runtime": "llamacpp",
     "runtimeVersion": "b6512",
     "runtimeFlags": "-fa 1 -ngl 99, SYCL backend",
     "decodeTps": 34.2,
     "promptTps": 410,
     "ttftMs": 120,
     "contextLength": 4096,
     "batchSize": 1,
     "runDate": "2026-09-04",
     "notes": "Fresh driver, no thermal throttling."
   }
   ```

   `runtimeFlags` is optional free text: the settings and build options that would change the number if someone
   rebuilt it. Leave `component` out for a whole-rig result. Ids come from [the catalog](../frontend/src/catalog/); the site's hardware pages show each part's id in the URL. Missing a part? [Add it](../frontend/src/catalog/README.md) first and have a maintainer deploy the catalog to the site and database before submitting your result.

3. Open a pull request against `main`. The **Result ingestion** check validates the JSON, matches the PR author’s numeric GitHub ID to their GitHub OAuth identity, and checks rig ownership and database constraints. If no linked account exists, the check asks you to sign up with that GitHub account and rerun it.
4. A maintainer merges the PR. The workflow reads the merged files and inserts all new results into Supabase in one transaction, attributed to your account with a link to the submission PR. No submit form is needed. The PR comment reports the result IDs or the error to fix.

### Optional evidence link

You can submit without an evidence link. If you have published benchmark logs, scripts, a gist, a report,
or a repository, add `evidenceUrl` to help others check the run:

```json
{
  "evidenceUrl": "https://example.com/benchmarks/my-run"
}
```

Use a full HTTPS URL; it does not have to be hosted on GitHub. Omit the field when you have no link.
The site keeps the submission PR link separately, whether or not you include `evidenceUrl`.

### Stock or a custom runtime

A run on the released runtime needs nothing extra. If you ran a changed runtime — a custom kernel or op, a patch,
a fork — name the custom runtime it ran on and the revision behind it:

```json
{
  "customRuntime": "7",
  "revision": "a8192fe"
}
```

`customRuntime` is the number at the end of its URL on the site, or its exact name, the same way `rig` works.
Register it once [by PR](../custom-runtimes/README.md) or on the site and every later result just names it.
For a registration added in the same PR, use `customRuntimeFile` with its repository-relative path instead of `customRuntime`. You can post against anyone's, not
only your own — a public fork is a real thing anyone can run, and one object per fork is what keeps those runs
comparable.

The revision is the point. An implementation changes week to week, so "a custom attention kernel" is not
reproducible and `a8192fe` is. A commit, a tag, or a build id all work.

Boards rank stock runs against each other and keep custom runtimes out unless a reader turns on **Include modified**, so a
changed stack is never mistaken for faster silicon. Custom runtimes are not lesser and nothing is hidden — they answer a
different question, rank among each other on the same board, and collect on their own pages.

The pull request stays as the public record of the run. Closing without merging does not submit anything. Account signup and rig registration are still one-time site steps. Custom runtimes can be registered in the same PR or in a standalone registration PR.

If ingestion fails after merge, no partial batch is committed. Fix the missing account, rig, or catalog configuration, then ask a maintainer to rerun **Validate and ingest result files**, or run it manually with the PR number. Retries read the original merge commit, not the current branch contents. A correction to invalid merged JSON requires a new result file in a new PR. If a merge reaches `main` but GitHub leaves the PR unmerged (or it was closed afterwards), a manual run with its PR number still ingests it, as long as the PR's head commit is on `main`.

The legacy form can still preview a PR, including its optional evidence link. Submission is disabled while previewing a PR: merge submits it for you. Make changes in the PR's JSON file. If you already submitted through the old form, add a `result` URL to the JSON to make it an archive.

## Write the file from a result

Every freshly submitted result offers **Add to the results repo**, which opens GitHub's new-file page with the JSON filled in, path and all, including `evidenceUrl` when provided. GitHub forks the repo for you if you cannot push to it. The file then carries a `result` link back to the live entry. Files with this field are archives and do not create or update database rows on merge.

## Rules

- Files live at `results/<your-github-handle>/<name>.json`. The check fails if the folder does not match the pull request author.
- Results are your own runs on your own rig. The site enforces rig ownership when the result is submitted.
- One result per new file, at most 100 combined result/registration files per PR and 64 KiB per file. The entire batch succeeds or fails together.
- Each imported repository path is recorded permanently. Rerunning the same PR is safe, including after a live result is deleted. Use a fresh path for each new run; renames and edits cannot submit or overwrite runs. Edit existing live results on the site. Removing a file never deletes a live result.
- Names must resolve to exactly one rig owned by you or one custom runtime for the selected runtime. Prefer numeric IDs when names are ambiguous.
- A successful pre-merge check is a point-in-time validation; merge rechecks the account and current database state.
- [`schema.json`](schema.json) describes the shape for editors. Check the shape and catalog locally with `npm --prefix frontend run results:validate -- results/<handle>/<name>.json`. OAuth identity and database checks run in the GitHub workflow.
