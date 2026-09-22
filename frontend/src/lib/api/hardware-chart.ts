import { MODEL_BY_ID, QUANT_BY_ID, RUNTIME_BY_ID } from '@/catalog'
import type { ChartBar, Result } from './types'

/** Keep each runtime's best run visible, even when another runtime is faster. */
export function hardwareChart(results: Result[]): ChartBar[] {
  const best = new Map<string, Result>()
  for (const result of results) {
    const key = `${result.modelId}/${result.quant}/${result.runtimeId}`
    const current = best.get(key)
    if (!current || result.decodeTps > current.decodeTps || (result.decodeTps === current.decodeTps && result.runDate < current.runDate)) {
      best.set(key, result)
    }
  }
  return [...best.values()]
    .sort((a, b) => b.decodeTps - a.decodeTps || a.runDate.localeCompare(b.runDate))
    .map((result) => ({
      label: `${MODEL_BY_ID[result.modelId]?.name ?? result.modelId} ${QUANT_BY_ID[result.quant]?.label ?? result.quant} · ${RUNTIME_BY_ID[result.runtimeId]?.name ?? result.runtimeId}`,
      tps: result.decodeTps,
      runtimeId: result.runtimeId,
      href: `/results/${result.id}`,
    }))
}
