> For the supported personal-key HTTP API, see [agent documentation](../frontend/public/docs/agents.md) and [deployment notes](AGENT_API_OPERATIONS.md). This document describes the frontend adapter contract.

# API contract (draft for Jack)

The front end talks to the network only through `src/lib/api.ts`, whose functions map one-to-one onto these endpoints. Anything not listed here is not needed for v1.

## Conventions

- JSON over HTTPS under `/api`. Dates are ISO 8601 strings. IDs are strings.
- Auth is a session cookie set by the GitHub OAuth callback. `GET /api/me` returns the current user or 401.
- List endpoints accept `limit` (default 25, max 100) and `cursor`, and return `{ items, nextCursor }`.
- Errors return `{ error: { code, message, fields? } }` with 400, 401, 403, 404, or 409.
- Hidden results are omitted everywhere except for their owner, who receives them with `moderation.hidden = true`.
- Ranking (best per hardware unit, highest decode tok/s, earliest run date on ties) is computed server-side.

## Auth

| Method | Path | Notes |
|---|---|---|
| GET | `/auth/github` | Redirects to GitHub with scope `read:user`. Accepts `?returnTo=` |
| GET | `/auth/github/callback` | Exchanges the code, upserts the user from the GitHub profile (login, name, avatar, bio), sets the session cookie, redirects to `returnTo` |
| POST | `/auth/logout` | Clears the session |
| GET | `/api/me` | Current `User` with `stats`, or 401 |

## Catalog

| Method | Path | Returns |
|---|---|---|
| GET | `/api/models` | `Model[]` with per-quant result counts |
| GET | `/api/models/:modelId` | `Model` |
| GET | `/api/models/summary` | `ModelSummary[]`: for each model, the quant with the most results as `board` — its rigs board, or its components board when the rigs board is empty, since most results name a part — that board's top three rows as `top`, and the single best row across all of its boards, both kinds, as `best`. Route this before `/api/models/:modelId` |
| GET | `/api/runtimes` | `Runtime[]` |
| GET | `/api/quants` | `Quant[]` |
| GET | `/api/hardware?type=&vendor=&q=&limit=&cursor=` | `HardwareItem[]` with `resultsCount` and `rigsCount` |
| GET | `/api/hardware/:hardwareId` | `HardwareItem` plus `chart: ChartBar[]`, `rigs: RigSummary[]`, `results: Result[]` (component-level results naming this part, best first) |

Catalog data comes from `frontend/src/catalog/`, the source of truth in this repo, which is synced to the database on merge (see [SUPABASE.md](SUPABASE.md#catalog-sync)). The front end never writes catalog data.

A CPU's `integrated` list is catalog data too. Results only ever name one part, so `GET /api/hardware/:hardwareId` for an iGPU or NPU returns the runs on that unit alone; the front end fetches a CPU's integrated parts separately to show the cores, iGPU, and NPU side by side. `componentHost` on a result is the rig's CPU whose `integrated` list contains `componentId`, or absent.

## Boards

| Method | Path | Returns |
|---|---|---|
| GET | `/api/boards/:modelId/:quant?kind=rigs\|components&allSubmissions=&includeModified=&runtime=&vendor=&type=&verification=&q=&limit=&cursor=` | `{ board: BoardMeta, items: BoardRow[], nextCursor, chart: ChartBar[] }` |

By default, boards keep only the best submission per rig or component and quantity. Set `allSubmissions=true` to return every published submission for the selected kind, ordered by decode tok/s descending with earliest run winning ties. Filters, stock-only defaults, and pagination apply to both views. `board.total` counts entries after filtering and grouping (or individual submissions in the all-submissions view), before pagination. The UI displays all submissions as an unranked results list; result-detail ranks continue to use the grouped leaderboard.

`chart` is the top ten rows of the same filtered view, so the chart and the table always agree.

## Rigs

| Method | Path | Notes |
|---|---|---|
| GET | `/api/rigs?owner=&hardware=&sort=newest\|results\|tps&limit=&cursor=` | `RigSummary[]` |
| GET | `/api/rigs/:rigId` | `Rig` plus `results: Result[]`, `chart: ChartBar[]` |
| POST | `/api/rigs` | Body `RigInput`. Signed in |
| PATCH | `/api/rigs/:rigId` | Body partial `RigInput`. Owner only |
| DELETE | `/api/rigs/:rigId` | Owner only. Deletes the rig's results too |

## Results

| Method | Path | Notes |
|---|---|---|
| GET | `/api/results?rig=&hardware=&model=&quant=&runtime=&user=&limit=&cursor=` | `Result[]`, newest first |
| GET | `/api/results/:resultId` | `Result` plus `rank: { kind, position, boardSize }` |
| POST | `/api/results` | Body `ResultInput`. Signed in. Server validates that `componentId` belongs to `rigId` and that `quant` is in the model's quant list |
| PATCH | `/api/results/:resultId` | Owner only. Any change resets verification to `self_reported` and clears confirmations |
| DELETE | `/api/results/:resultId` | Owner only |
| POST | `/api/results/:resultId/confirm` | Toggle. Signed in, not the owner. Returns updated `verification` |
| POST | `/api/results/:resultId/flag` | Body `{ reason, note? }`. Toggle. Signed in, not the owner. Returns updated `moderation` |

Thresholds for `community_verified` and `hidden` are server configuration. Proposal: 3 and 3.

## Users

| Method | Path | Returns |
|---|---|---|
| GET | `/api/users/:handle` | `User` with `stats` |
| GET | `/api/users/:handle/rigs` | `RigSummary[]` |
| GET | `/api/users/:handle/results` | `Result[]` |

## Home and uploads

| Method | Path | Notes |
|---|---|---|
| GET | `/api/home` | `{ stats, topRigs: RigSummary[] }` |
| GET | `/api/results/top?model=&quant=&limit=` | `{ items: BoardRow[], chart: ChartBar[], total }`. Site-wide ranking: best entry per rig-or-part, model, and quant by decode tok/s, hidden entries excluded. Route this before `/api/results/:resultId` |
| POST | `/api/uploads` | Multipart image, max 5 MB, returns `{ url }`. Signed in. Used for rig photos |

## OG images and sharing

Served by the front-end deploy on Vercel, not by this API. Nothing for Jack to build.

| Route | What it does |
|---|---|
| `GET /api/og/result?id=&v=` | The 1200×630 result card (number-led layout). Vercel Function, `frontend/api/og/result.ts`. 404 for hidden or missing results. `/api/og/results/:id.png` rewrites here |
| `GET /api/og/rig?id=&v=` | The rig card (photo and parts; parts-only when there is no photo). `frontend/api/og/rig.ts`. `/api/og/rigs/:id.png` rewrites here |
| `/`, `/models`, `/hardware`, `/rigs`, `/results/:id`, `/rigs/:id` | `frontend/middleware.ts` serves the SPA shell with that page's own title, description, canonical, and card in the head, to browsers and crawlers alike; when the shell can't be read, crawlers get a bare page with the same tags |

The edge code reads the public Supabase REST endpoints with the publishable key from the same `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` the site is deployed with, mirrors the board ordering in `src/lib/api/supabase.ts` for rank, and composites text over static assets in `frontend/public/og/` (dot-matrix backgrounds, lockup, Red Hat fonts) built by `npm run og:assets`. `?v=updatedAt` busts the day-long edge cache after an edit. `npm run og:preview` renders the layouts with sample data to `.og-preview/` for a local check; the edge functions themselves only run on Vercel (`vercel dev` locally).

The share modal (`src/components/ShareDialog.tsx`) previews, downloads, and copies that same PNG, and opens the share intents for X, Reddit, LinkedIn, Threads, and Facebook; Discord has none, so its button copies the link and opens Discord.

## Types

```ts
export type Quant = { id: string; label: string; bits: number; format: string };

export type Model = {
  id: string; name: string; family: string; params: string;
  brand: string; // the family at the logo level (Qwen, Gemma); the Models page groups by it. Catalog-only, not stored
  architecture: "dense" | "moe"; activeParams?: string; sourceUrl: string;
  logoUrl?: string; brandColor?: string; // logo is a catalog asset; brandColor drives the monogram fallback
  quants: string[]; resultCounts?: Record<string, number>;
};

export type Runtime = { id: string; name: string; logoUrl: string; repoUrl: string; color: string };

export type HardwareType = "cpu" | "gpu" | "igpu" | "npu" | "ram";

// `color` is the runtime's categorical chart color, set in the catalog.
// `integrated`, on CPUs only, lists the ids of the iGPU and NPU on the same package. It is catalog data. Those parts
// stay hardware items of their own, with their own pages and board rows; the front end derives the reverse link.
export type HardwareItem = {
  id: string; type: HardwareType; vendor: string; name: string; series?: string;
  specs: Record<string, string | number>; releaseDate?: string; imageUrl?: string;
  source: "seeded" | "community"; integrated?: string[]; resultsCount?: number; rigsCount?: number;
};

export type User = {
  id: string; handle: string; name?: string; avatarUrl: string; bio?: string;
  createdAt: string; tier?: null;
  stats?: { results: number; rigs: number;
            bestRank?: { modelId: string; quant: string; kind: "rigs" | "components"; position: number };
            confirmationsGiven: number };
};

export type RigComponent = { hardwareId: string; quantity: number; hardware?: HardwareItem };

export type Rig = {
  id: string; ownerId: string; owner?: User; name: string; os: string;
  photoUrl?: string; notes?: string; components: RigComponent[];
  summary: string; createdAt: string; updatedAt: string;
};
export type RigSummary = Pick<Rig, "id" | "name" | "photoUrl" | "summary" | "owner"> &
  { resultsCount: number; bestTps?: number; components?: { hardwareId: string; quantity: number }[] }; // components draw the placeholder when there is no photo
export type RigInput = Pick<Rig, "name" | "os" | "photoUrl" | "notes"> & { components: { hardwareId: string; quantity: number }[] };

export type Verification = { status: "self_reported" | "community_verified"; confirmations: number; confirmedByMe?: boolean };
export type Moderation = { flags: number; hidden: boolean; flaggedByMe?: boolean; reasons?: FlagReason[] };
export type FlagReason = "implausible" | "wrong_hardware" | "duplicate" | "spam" | "other";

export type Result = {
  id: string; submitterId: string; submitter?: User;
  modelId: string; quant: string; runtimeId: string; runtimeVersion: string;
  rigId: string; rig?: RigSummary; componentId?: string; componentQuantity?: number; component?: HardwareItem;
  componentHost?: HardwareItem; // when the part is an iGPU or NPU: the CPU in the rig whose package carries it
  decodeTps: number; promptTps?: number; ttftMs?: number; contextLength?: number; batchSize?: number;
  notes?: string; repoUrl?: string; sourcePrUrl?: string; runDate: string;
  verification: Verification; moderation: Moderation; createdAt: string; updatedAt: string;
};
export type ResultInput = Omit<Result, "id" | "submitterId" | "submitter" | "rig" | "component" | "verification" | "moderation" | "createdAt" | "updatedAt" | "sourcePrUrl">;

export type BoardMeta = { modelId: string; quant: string; kind: "rigs" | "components"; total: number };
export type BoardRow = {
  rank: number; result: Result;
  unit: { kind: "rig"; rig: RigSummary } | { kind: "component"; hardware: HardwareItem; quantity: number };
};
export type ChartBar = { label: string; tps: number; runtimeId: string; href: string };
export type TopResultsResponse = { items: BoardRow[]; chart: ChartBar[]; total: number };
export type ModelSummary = { model: Model; board: BoardMeta; top: BoardRow[]; best?: BoardRow }; // board.kind says which board `top` is from; best: the top row across every quant board of either kind

```
