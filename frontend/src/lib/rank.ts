import type { BoardKind, Result, ResultRank } from '@/lib/api/types'
import { DEFAULT_SETUP, SETUP_BY_ID, setupOf } from '@/lib/setups'

/**
 * Where a result stands on its board. The board keeps one row per rig or part (that unit's fastest result), so a
 * result either is its unit's row and gets that row's place, or is not on the board, and the result holding the
 * unit's row is named instead. Each result ranks within its own setup, or within All results when it matches none.
 *
 * `rankedIn(setup)` builds that board: best per unit, sorted, with the setup applied.
 */
export function resultRank(
  result: Result,
  kind: BoardKind,
  rankedIn: (setup: ResultRank['setup']) => Result[],
  unitKey: (r: Result) => string,
): ResultRank | undefined {
  const setup = setupOf(result)?.id ?? 'all'
  const ranked = rankedIn(setup)
  const index = ranked.findIndex((candidate) => unitKey(candidate) === unitKey(result))
  if (index < 0) return undefined
  const holder = ranked[index]
  const base = { kind, setup, boardSize: ranked.length }
  return holder.id === result.id ? { ...base, position: index + 1 } : { ...base, heldBy: { id: holder.id, position: index + 1 } }
}

/** The board a rank refers to, opened on the setup tab the result ranks in. */
export function rankBoardPath(r: Pick<Result, 'modelId' | 'quant'>, rank: ResultRank): string {
  const params = new URLSearchParams({ kind: rank.kind })
  if (rank.setup !== DEFAULT_SETUP) params.set('setup', rank.setup)
  return `/models/${r.modelId}/${r.quant}?${params}`
}

/** "on the Qwen3.8-27B Q4_K_M components board", plus the setup when it is not All results. */
export function boardPhrase(rank: ResultRank, model: string, quant: string): string {
  return `on the ${model} ${quant} ${rank.kind} board${rank.setup === 'all' ? '' : `, ${SETUP_BY_ID[rank.setup].name} setup`}`
}

/** What holds a board row: one rig, or one part (at a quantity) across every rig. */
export function unitPhrase(r: Pick<Result, 'component' | 'componentQuantity' | 'rig'>): string {
  if (!r.component) return r.rig?.name ?? 'This rig'
  const quantity = r.componentQuantity ?? 1
  return `${quantity > 1 ? `${quantity}× ` : ''}${r.component.name}`
}
