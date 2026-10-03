# Intelinside

**A community leaderboard of AI inference on Intel hardware.** How fast do local models actually run on Arc
cards, Core Ultra chips, Xeon, and Gaudi? Not in a vendor's slide deck.

People sign in with GitHub, register the rigs they run models on, and post the decode tokens per second they
get for a model at a given quantization on a given runtime. Results are self-reported and confirmed by the
community. The hardware database is open and grows by pull request.

Powered by [Cascadia](https://cascadia.to/).

## How it works

A **rig** is a machine, and it decomposes into **parts**. A result can describe the whole rig or one unit
inside it — a single card, the CPU cores, the iGPU, or the NPU. A Core Ultra chip therefore holds three
separate numbers, and the boards keep them apart.

A **board** is one model at one quantization. Each rig, or each part at a given quantity, appears once per
board at its best decode tok/s; the earliest run wins a tie. Boards mix runtimes, and filter by runtime when
you want to compare like with like.

Every result starts self-reported. Once enough signed-in members confirm it, it becomes community-verified.
Implausible numbers get flagged, and past a few flags an entry is hidden pending review.

## Contributing

Two things grow by pull request, and both are checked automatically when you open one:

| You want to | Go to |
|---|---|
| Post a benchmark result | [`results/`](results/README.md) — add `results/<your-handle>/<name>.json`, the check verifies your linked GitHub account, and merging imports the result automatically |
| Add a GPU, CPU, model, or runtime | [`frontend/src/catalog/`](frontend/src/catalog/README.md) — one file, one entry |

You can also submit a result straight from the site, no git involved. [CONTRIBUTING.md](CONTRIBUTING.md) has
the full picture, including how to run the app locally.

## Repository layout

```
frontend/          Vite + React 19 + Tailwind 4 single-page app
  src/catalog/     The hardware, model, quant, and runtime catalog — source of truth
  src/lib/api/     Typed API contract, with supabase, mock, and live adapters
  src/og/          Open Graph card rendering, shared by the app and the edge functions
  api/og/          Vercel edge functions that serve the share images
  scripts/         Catalog seeding, mark generation, OG previews, validators
results/           Benchmark results submitted as files, one folder per GitHub handle
supabase/          Migrations and database smoke tests
docs/              API contract and Supabase environment notes
```

## Running it locally

Node 22 or newer.

```bash
npm --prefix frontend install
npm --prefix frontend run dev
```

That is the whole setup. With no `frontend/.env` the app runs on generated mock data — every page, every
flow, no credentials, no backend — on port 5173.

To point it at a real Supabase project instead, copy `frontend/.env.example` to `frontend/.env` and fill in
the project URL and publishable key. [docs/SUPABASE.md](docs/SUPABASE.md) covers the hosted environments.

### Commands

All run from the repo root.

```bash
npm --prefix frontend run dev               # dev server on :5173
npm --prefix frontend run build             # typecheck and build to frontend/dist
npm --prefix frontend run typecheck         # tsc, no emit
npm --prefix frontend run catalog:validate  # check the catalog
npm --prefix frontend run results:validate -- results/<handle>/<file>.json
npm --prefix frontend run og:preview        # render the share cards to frontend/.og-preview/
```

## Stack

Vite, React 19, Tailwind 4, react-router, and shadcn/ui components on Base UI primitives, dark mode only.
Supabase for auth (GitHub OAuth), Postgres, and rig photos, with row-level security enforcing ownership.
Deployed on Vercel; the Open Graph cards are rendered by edge functions with Satori.

## Docs

- [docs/API.md](docs/API.md) — the typed API contract the front end is written against
- [docs/SUPABASE.md](docs/SUPABASE.md) — environments, migrations, and OAuth setup

## License

[MIT](LICENSE), for the code and the data in this repository.

Two things the licence does not cover. The brand assets in `frontend/public/logos/` (the Intelinside lockup
and the Cascadia wordmark) are not licensed for reuse, so a fork needs its own name and mark.

The vendor logos beside them, and every hardware, model, and runtime name in the catalog, are trademarks of their
owners, used here only to identify what a result ran on.

Intelinside is an independent community project. Intel, Arc, Core Ultra, Xeon, and Gaudi are trademarks of
Intel Corporation. We are not affiliated with, endorsed by, or sponsored by Intel Corporation, or by any
other vendor or project named here.

### Agent access

Users can create personal API keys at `/settings/api-keys`, then give their agent
[the API guide](frontend/public/docs/agents.md). The API supports rigs, custom runtimes,
results, photos, confirmations, and flags. Maintainer setup and reproducible tests
are in [the operations guide](docs/AGENT_API_OPERATIONS.md).
