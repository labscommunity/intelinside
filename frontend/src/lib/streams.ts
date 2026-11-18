import type { Result } from '@/lib/api/types'
import { MODEL_BY_ID, QUANT_BY_ID } from '@/catalog'

/** One measured point of a series: the x value (request count or prompt tokens), the decode rate, and its result. */
export type StreamPoint = { x: number; decodeTps: number; resultId: string }

/**
 * What a curve is drawn against. `concurrency`: decode against simultaneous requests, as a total or per request.
 * `input`: decode for one request against the prompt length it followed.
 */
export type StreamAxis = 'concurrency' | 'input'

/**
 * Results of one setup (model, quant, runtime, build, part) measured at several points of one axis. On the
 * concurrency axis a scaling study produces two curves, the machine's total across requests and what each request
 * sees, and a single-request result is the first point of both, since one request's rate is also the total.
 */
export type StreamSeries = {
  key: string
  axis: StreamAxis
  scope: 'total' | 'per_request'
  label: string
  modelId: string
  quant: string
  runtimeId: string
  points: StreamPoint[]
}

const unit = (r: Result) => (r.componentId ? `${r.componentQuantity ?? 1}× ${r.component?.name ?? r.componentId}` : '')

type Placement = { scope: StreamSeries['scope']; x: number }

/**
 * Groups results into series per setup with at least two distinct x values. When a setup was measured more than
 * once at the same x, the best rate stands, as on the boards. Hidden results are left out.
 */
function group(results: Result[], axis: StreamAxis, place: (r: Result) => Placement[]): StreamSeries[] {
  const groups = new Map<string, StreamSeries>()
  for (const r of results) {
    if (r.moderation.hidden) continue
    for (const { scope, x } of place(r)) {
      const base = [r.modelId, r.quant, r.runtimeId, r.customRuntimeId ?? '', r.componentId ?? '', r.componentQuantity ?? ''].join('|')
      const key = `${axis}|${scope}|${base}`
      let series = groups.get(key)
      if (!series) {
        const model = MODEL_BY_ID[r.modelId]?.name ?? r.modelId
        const quant = QUANT_BY_ID[r.quant]?.label ?? r.quant
        const part = unit(r)
        series = { key, axis, scope, label: `${model} ${quant}${part ? ` · ${part}` : ''}`, modelId: r.modelId, quant: r.quant, runtimeId: r.runtimeId, points: [] }
        groups.set(key, series)
      }
      const existing = series.points.find((p) => p.x === x)
      if (!existing) series.points.push({ x, decodeTps: r.decodeTps, resultId: r.id })
      else if (r.decodeTps > existing.decodeTps) Object.assign(existing, { decodeTps: r.decodeTps, resultId: r.id })
    }
  }
  return [...groups.values()]
    .filter((series) => series.points.length >= 2)
    .map((series) => ({ ...series, points: [...series.points].sort((a, b) => a.x - b.x) }))
    .sort((a, b) => a.scope.localeCompare(b.scope) || a.label.localeCompare(b.label) || a.runtimeId.localeCompare(b.runtimeId))
}

/**
 * Decode against concurrent requests. Results without a recorded `concurrency` are left out (the legacy
 * `batchSize` never had a fixed meaning).
 */
export function streamSeries(results: Result[]): StreamSeries[] {
  return group(results, 'concurrency', (r) => {
    if (r.concurrency == null || r.concurrency < 1) return []
    const scopes: StreamSeries['scope'][] = r.concurrency === 1 ? ['total', 'per_request'] : r.decodeScope === 'total' ? ['total'] : r.decodeScope === 'per_request' ? ['per_request'] : []
    return scopes.map((scope) => ({ scope, x: r.concurrency! }))
  })
}

/**
 * Decode for one request against prompt length: how much slower decode gets as the context fills. Only results with
 * `inputTokens` and exactly one request recorded count (the legacy `contextLength` meant the prompt to some and the
 * window to others). Speculative runs are left out so they never pose as a faster point on the same line.
 */
export function contextSeries(results: Result[]): StreamSeries[] {
  return group(results, 'input', (r) =>
    r.inputTokens != null && r.concurrency === 1 && r.speculative !== 'lossless' && r.speculative !== 'lossy'
      ? [{ scope: 'per_request', x: r.inputTokens }]
      : [])
}
