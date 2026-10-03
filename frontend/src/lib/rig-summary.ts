import { HARDWARE_BY_ID } from '@/catalog'
import type { HardwareItem } from '@/lib/api/types'

/** The build description shared by saved rigs and the editor preview. */
export function rigSummaryLine(components: { hardwareId: string; quantity: number }[]): string {
  const parts = components.map((c) => ({ hardware: HARDWARE_BY_ID[c.hardwareId], quantity: c.quantity }))
    .filter((p): p is { hardware: HardwareItem; quantity: number } => !!p.hardware)
  const label = (p: typeof parts[number]) => `${p.quantity > 1 ? `${p.quantity}× ` : ''}${p.hardware.name}`
  const summary = parts.filter((p) => p.hardware.type === 'cpu').map(label)
  const gpus = parts.filter((p) => p.hardware.type === 'gpu')
  if (gpus.length) summary.push(...gpus.map((p) => `${p.quantity}× ${p.hardware.name}`))
  else summary.push(...parts.filter((p) => p.hardware.type === 'igpu').map(label))
  const memory = parts.filter((p) => p.hardware.type === 'ram')
  if (memory.length) {
    const total = memory.reduce((sum, p) => sum + p.quantity * Number(p.hardware.specs.capacityGb ?? 0), 0)
    summary.push(`${total} GB ${memory[0].hardware.specs.type ?? ''}`.trim())
  }
  return summary.join(' · ')
}
