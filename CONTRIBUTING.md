# Contributing

There are three ways in, and the first two need no local setup at all.

1. **[Post a result](#post-a-result)** — a number you measured, on hardware you own.
2. **[Add hardware, a model, or a runtime](#add-to-the-catalog)** — so other people can post results against it.
3. **[Work on the site](#work-on-the-site)** — the app itself.

Everything here is checked automatically when you open a pull request, and the check comments on your PR with
what it found. You do not have to get it right the first time.

---

## Post a result

**The easy way:** sign in on the site and use the submit form. Nothing below is required.

**By pull request**, if you would rather your run live in git:

1. Sign in on the site once and register the rig you ran on. Results are tied to a rig you own, and the check
   enforces it. Your rig's URL ends in a number — that number goes in the file.
2. Add `results/<your-github-handle>/<name>.json`. The folder has to match your handle.
3. Open the pull request using the GitHub account you signed up with. The **Result ingestion** check
   verifies your OAuth identity, the catalog, rig ownership, and database constraints. A missing account
   fails the check with signup instructions; sign in and ask a maintainer to rerun it.
4. A maintainer merges it. The workflow inserts your results into Supabase automatically and reports
   the result IDs on the PR. No web submission is needed.

The full format, archive behavior, and retry instructions are in [`results/README.md`](results/README.md).
An agent can submit using your authenticated GitHub CLI session. Bot-authored PRs cannot be attributed
without a linked personal account. Account signup and rig registration remain one-time site steps.

### What makes a good result

- Generate at least 256 tokens from a short prompt and average over a few runs.
- Measure one request at a time. A throughput configuration — OpenVINO's
  `PERFORMANCE_HINT=THROUGHPUT`, vLLM serving many sequences at once, llama.cpp with parallel slots —
  reports the total across concurrent requests, which is a larger and different number from what one
  person sees waiting for one answer. If that is what you measured, say so in the flags and set the
  batch size.
- Report the runtime version. An evidence link is optional: benchmark logs, scripts, a gist, a report,
  or a repository can help others check your result. Any full HTTPS URL works; no separate repository
  is required. In PR JSON, use `evidenceUrl`. The submission PR is recorded separately.
- Note the flags and settings that moved the number — backend, flash attention, KV cache precision. The same
  card on the same runtime can differ twofold on these.
- Say whether it ran on a stock runtime or a custom runtime. Stock means the released runtime, however you configured
  or built it. If you changed the runtime itself — custom kernel or op, patch, fork — register it once as a
  custom runtime and name it, along with the exact revision, so someone else can reproduce the number. You can post on
  anyone's, not only your own. Boards rank stock alone by default, so a changed stack is never mistaken
  for faster hardware.
- Ran on one card out of several? Submit it as a component result and set the quantity you used.
- A Core Ultra chip carries CPU cores, an iGPU, and an NPU, and each is its own part. Submit the unit the
  model actually ran on. Use whole rig when the run spanned more than one.
- Results are your own runs on your own hardware. Numbers copied from a review or a vendor benchmark are not
  results.

Check a file before you push:

```bash
npm --prefix frontend run results:validate -- results/<your-handle>/<name>.json
```

---

## Add to the catalog

Missing a GPU, a CPU, a model, or a runtime? It lives in one file,
[`frontend/src/catalog/index.ts`](frontend/src/catalog/index.ts), and adding an entry is a pull request
against it. [`frontend/src/catalog/README.md`](frontend/src/catalog/README.md) has the fields, the
conventions, and examples for each kind of entry.

The short version: append the entry next to its neighbours, keep the id lowercase and hyphenated, and run

```bash
npm --prefix frontend run catalog:validate
```

Parts from any vendor are welcome — comparisons are only honest if the competition is on the board. One
caveat worth knowing before you spend time on it: the browse pages currently show only `Intel` and `Generic`
parts. See the note in the catalog README.

If you cannot write TypeScript, open an issue with the part and its specs instead and someone will add it.

---

## Work on the site

```bash
npm --prefix frontend install
npm --prefix frontend run dev
```

With no `frontend/.env` the app runs on generated mock data, so you can work on almost anything without a
backend or a single credential. Copy `frontend/.env.example` to `frontend/.env` when you need a real Supabase
project. The dev server insists on port 5173 and fails loudly rather than picking another, because Supabase
has to allow-list the OAuth redirect.

One extra mode exists, on mock data, for working on the empty states:

```bash
npm --prefix frontend run dev -- --mode empty   # nobody has registered a rig or posted a result yet
```

Before you open a pull request:

```bash
npm --prefix frontend run typecheck
npm --prefix frontend run build
```

### House style

The code has a voice; match the file you are editing rather than a general standard.

- **Comments explain why, not what.** Most files carry a short header comment saying what the module is for
  and what decision shaped it. Keep that up when you change the decision.
- **No comment for the obvious.** If the code says it, do not repeat it in prose.
- **Copy is part of the change.** UI text is plain and specific — "The board is sealed", not "Content
  unavailable". If your change alters what the user sees, write the sentence too.
- **Types over guards.** The API contract in [`frontend/src/lib/api/types.ts`](frontend/src/lib/api/types.ts)
  mirrors [`docs/API.md`](docs/API.md); when one moves, move the other.
- Tailwind utilities inline, `cn()` to merge; shared patterns live in the `components/` file that owns them.

### Database changes

Migrations live in `supabase/migrations/`. Validate them with the isolated local tests before a reviewed production deployment; the configured hosted database is production. Catalog rows need no
migration: merging a change to `frontend/src/catalog/` syncs it to the database. To seed a fresh local database
after its migrations, generate the SQL rather than hand-writing it:

```bash
npm --prefix frontend run catalog:seed
```

[`docs/SUPABASE.md`](docs/SUPABASE.md) covers environments and how migrations get pushed. Only maintainers
push to the hosted projects.

---

## Reporting a problem

Wrong numbers on a result you did not post are best handled with the flag button on the site — it is what the
moderation threshold is for. Bugs, missing hardware, and everything else go in
[issues](https://github.com/labscommunity/intelinside/issues).

Found a security issue? Do not open a public issue. Use GitHub's private vulnerability reporting on the
[Security tab](https://github.com/labscommunity/intelinside/security/advisories/new).

---

## Licensing your contribution

The project is [MIT](LICENSE). Open a pull request — code, a catalog entry, or a result — and you are
offering that work under the same licence, and confirming it is yours to give. There is nothing to sign.

The brand assets are the exception. The Intelinside lockup and the Cascadia wordmark in
`frontend/public/logos/` are not covered by the licence, and neither are the vendor logos beside them.

Custom runtimes can also be registered with a [JSON-only PR](custom-runtimes/README.md), independently of benchmark results.
