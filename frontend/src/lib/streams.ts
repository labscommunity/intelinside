import type { Result } from '@/lib/api/types'
import { MODEL_BY_ID, QUANT_BY_ID } from '@/catalog'

/** One measured point of a series: how many requests ran at once and the decode rate recorded for it. */
export type StreamPoint = { concurrency: number; decodeTps: number; resultId: string }

/**
 * Results of one setup (model, quant, runtime, build, part) measured at several request counts, as the two curves a
 * scaling study produces: the machine's total across requests, and what each request sees. A single-request result
 * is the first point of both, since one request's rate is also the total.
 */
export type StreamSeries = {
  key: string
  scope: 'total' | 'per_request'
  label: string
  modelId: string
  quant: string
  runtimeId: string
  points: StreamPoint[]
}

const unit = (r: Result) => (r.componentId ? `${r.componentQuantity ?? 1}× ${r.component?.name ?? r.componentId}` : '')

/**
 * Group a rig's results into series with at least two distinct request counts. Results without a recorded
 * `concurrency` are left out (the legacy `batchSize` never had a fixed meaning), as are hidden ones. When a setup
 * was measured more than once at the same request count, the best rate stands, as on the boards.
 */
export function streamSeries(results: Result[]): StreamSeries[] {
  const groups = new Map<string, StreamSeries>()
  for (const r of results) {
    if (r.moderation.hidden || r.concurrency == null || r.concurrency < 1) continue
    const scopes: StreamSeries['scope'][] = r.concurrency === 1 ? ['total', 'per_request'] : r.decodeScope === 'total' ? ['total'] : r.decodeScope === 'per_request' ? ['per_request'] : []
    for (const scope of scopes) {
      const base = [r.modelId, r.quant, r.runtimeId, r.customRuntimeId ?? '', r.componentId ?? '', r.componentQuantity ?? ''].join('|')
      const key = `${scope}|${base}`
      let series = groups.get(key)
      if (!series) {
        const model = MODEL_BY_ID[r.modelId]?.name ?? r.modelId
        const quant = QUANT_BY_ID[r.quant]?.label ?? r.quant
        const part = unit(r)
        series = { key, scope, label: `${model} ${quant}${part ? ` · ${part}` : ''}`, modelId: r.modelId, quant: r.quant, runtimeId: r.runtimeId, points: [] }
        groups.set(key, series)
      }
      const existing = series.points.find((p) => p.concurrency === r.concurrency)
      if (!existing) series.points.push({ concurrency: r.concurrency, decodeTps: r.decodeTps, resultId: r.id })
      else if (r.decodeTps > existing.decodeTps) Object.assign(existing, { decodeTps: r.decodeTps, resultId: r.id })
    }
  }
  return [...groups.values()]
    .filter((series) => series.points.length >= 2)
    .map((series) => ({ ...series, points: [...series.points].sort((a, b) => a.concurrency - b.concurrency) }))
    .sort((a, b) => a.scope.localeCompare(b.scope) || a.label.localeCompare(b.label) || a.runtimeId.localeCompare(b.runtimeId))
}
