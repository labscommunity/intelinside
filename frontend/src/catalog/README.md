# The catalog

Every hardware part, model, quantization, and runtime the site knows about lives in
[`index.ts`](index.ts). It is the source of truth: the database is seeded from it, result files are validated
against it, and the boards are built out of it. Adding a part is a pull request against this one file.

## Add hardware

Append an `hw(...)` call to `HARDWARE`, in the section for its type. The arguments, in order:

| | | |
|---|---|---|
| `id` | required | Lowercase, hyphenated, unique, and stable. It ends up in the page URL and in result files, so pick it once: `intel-arc-b580`, not `arc-b580-2025`. |
| `type` | required | `cpu`, `gpu` (discrete), `igpu`, `npu`, or `ram`. |
| `vendor` | required | `Intel`, `AMD`, `NVIDIA`, `Apple`, or `Generic` for unbranded memory. |
| `name` | required | As the vendor writes it: `Arc Pro B60`, `Core Ultra 9 285K`. No vendor prefix; the vendor is its own field. |
| `specs` | required | The numbers people compare. Use the keys the neighbouring entries use so the tables line up — GPUs: `vramGb`, `memoryType`, `xeCores`, `tdpW`. CPUs: `cores`, `threads`, `boostGhz`, `tdpW`, `platform`. |
| `releaseDate` | optional | `YYYY-MM-DD`. |
| `series` | optional | The family it is sold under: `Arc Pro B`, `Core Ultra 200S`. |
| `integrated` | CPUs only | Ids of the iGPU and NPU on the package. |

```ts
hw('intel-arc-b580', 'gpu', 'Intel', 'Arc B580', { vramGb: 12, memoryType: 'GDDR6', xeCores: 20, tdpW: 190 }, '2024-12-13', 'Arc B'),
```

### A CPU carries its iGPU and NPU

A Core Ultra chip is three parts, not one: the cores, the graphics on the package, and the NPU. Each gets its
own catalog entry, its own page, and its own board row, so a run on the iGPU never ranks against a run on the
cores. Add all three, then name the two children in the CPU's `integrated` list:

```ts
hw('intel-arc-140v', 'igpu', 'Intel', 'Arc Graphics 140V', { xeCores: 8, platform: 'Lunar Lake' }, '2024-09-24', 'Arc'),
hw('intel-ai-boost-npu-4', 'npu', 'Intel', 'AI Boost NPU 4 (Lunar Lake)', { tops: 48, platform: 'Lunar Lake' }, '2024-09-24', 'AI Boost'),
hw('intel-core-ultra-7-258v', 'cpu', 'Intel', 'Core Ultra 7 258V', { cores: 8, threads: 8, boostGhz: 4.8, tdpW: 17, platform: 'Lunar Lake' }, '2024-09-24', 'Core Ultra 200V', ['intel-arc-140v', 'intel-ai-boost-npu-4']),
```

### Non-Intel parts

Other vendors are welcome so the comparisons stay honest, but note that `VISIBLE_HARDWARE` at the bottom of
`index.ts` currently narrows hardware browsing and the rig component picker to `Intel`, `AMD`, `NVIDIA`, and `Generic`. A part from another vendor is a valid
catalog entry and results can reference it; it will not appear in the hardware browser until that filter
changes.

## Add a model

Append to `MODELS`. Every model needs `sourceUrl` (the model card) and a `quants` list; each quant in that list
becomes its own leaderboard, so list only the ones people actually run.

```ts
{
  id: 'qwen3-8b', name: 'Qwen3-8B', family: 'Qwen3', brand: 'Qwen', params: '8B', architecture: 'dense',
  sourceUrl: 'https://huggingface.co/Qwen/Qwen3-8B', logoUrl: '/logos/models/qwen.svg', brandColor: '#b699eb',
  quants: ['int4', 'q4_k_m', 'q8_0', 'fp16'],
}
```

`family` is the generation (`Qwen3.5`, `Gemma 4`); `brand` is the family at the logo level (`Qwen`, `Gemma`),
which the Models page groups by — every model that shares a logo shares a brand. A mixture-of-experts model
sets `architecture: 'moe'` and `activeParams`. `logoUrl` points at an SVG in `frontend/public/logos/models/`;
leave it out and the UI draws a monogram tile in `brandColor`.

## Add a quantization or a runtime

`QUANTS` needs `label` (as people write it: `Q4_K_M`), `bits`, and a one-line `format` used in tooltips. GGUF
quant ids keep their underscores; everything else is hyphenated.

`RUNTIMES` needs `name`, `repoUrl` (every runtime badge links to it), and a six-digit hex `color`. The badge
looks for a mark in three places, in order: `logoUrl`, an SVG under `frontend/public/logos/runtimes/`; a
generated mark, if you add the runtime to the `RUNTIMES` map in `frontend/scripts/generate-marks.mjs` and run
`npm run marks`, which pulls it from [Simple Icons](https://simpleicons.org); or a two-letter tile in `color`.
Leaving `logoUrl` empty is fine — the tile is a reasonable default.

## Check your change

```bash
npm --prefix frontend run catalog:validate
```

It checks that ids are unique and well formed, that `integrated` and `quants` resolve, and that the required
fields are there. It also lays out the part's placeholder drawing — the schematic that stands in for a rig photo
is drawn from `specs` and `series` (`frontend/src/lib/schematic.ts`) — and fails if the printed model number
cannot fit, which usually means the `name` needs a shorter model token. `npm --prefix frontend run typecheck`
catches shape errors. Both run on your pull request, and the catalog check comments the result on it.

Nothing else is needed from you. When the pull request merges, the **Sync the catalog to Supabase** workflow
writes the entry to the database, and the site shows it with the next deploy. Results that use a new entry
can be submitted once that sync has run.

Removing or renaming an id is different: the sync never deletes, because results may reference the old id. It
lists such rows in its summary, and retiring them takes a reviewed migration.
