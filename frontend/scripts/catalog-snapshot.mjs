// The catalog as database rows. `catalog:seed` and the production catalog sync both use this mapping, so the
// SQL seed and the synced tables cannot drift apart. Column names match supabase/migrations.
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

// Compile the catalog without starting a dev server or loading the application's Vite config.
export async function loadCatalog() {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../src/catalog/index.ts', import.meta.url))],
    alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
    bundle: true, write: false, platform: 'node', format: 'esm', logLevel: 'silent',
  })
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`)
}

// Tables in foreign-key order: quants and models before the boards that join them.
export function catalogSnapshot({ QUANTS, MODELS, RUNTIMES, HARDWARE }) {
  return {
    quants: QUANTS.map((q) => ({ id: q.id, label: q.label, bits: q.bits, format: q.format })),
    models: MODELS.map((m) => ({
      id: m.id, name: m.name, family: m.family, params: m.params, architecture: m.architecture,
      active_params: m.activeParams ?? null, source_url: m.sourceUrl, logo_url: m.logoUrl ?? null, brand_color: m.brandColor ?? null,
    })),
    model_quants: MODELS.flatMap((m) => m.quants.map((quant) => ({ model_id: m.id, quant_id: quant }))),
    runtimes: RUNTIMES.map((r) => ({ id: r.id, name: r.name, logo_url: r.logoUrl, repo_url: r.repoUrl, color: r.color })),
    // Every part, including vendors the browse pages hide: results can reference them.
    hardware: HARDWARE.map((h) => ({
      id: h.id, type: h.type, vendor: h.vendor, name: h.name, series: h.series ?? null, specs: h.specs,
      release_date: h.releaseDate ?? null, image_url: h.imageUrl ?? null, source: h.source, integrated: h.integrated ?? [],
    })),
  }
}
