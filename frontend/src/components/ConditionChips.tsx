import { Badge } from '@/components/ui/badge'
import { compactChips, conditionChips, hasConditions, methodChips, workloadChips, type Conditions } from '@/lib/conditions'
import { setupOf } from '@/lib/setups'
import type { Result } from '@/lib/api/types'
import { fmtInt } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * The conditions a result was measured under, as small chips. A result without any says so, and shows the legacy
 * context length and batch size instead when it has them, labelled as such because their meaning was never fixed.
 */
export function ConditionChips({ result, part = 'all', className }: {
  result: Partial<Conditions> & Pick<Partial<Result>, 'contextLength' | 'batchSize'>
  /** `workload` or `method` shows half, for layouts that split them; legacy fields go with the workload. `compact` is one board row. */
  part?: 'all' | 'workload' | 'method' | 'compact'
  className?: string
}) {
  if (!hasConditions(result)) {
    if (part === 'method' || part === 'compact') return <span className={cn('text-muted-foreground', className)}>Not recorded</span>
    const legacy = [
      result.contextLength != null ? `context ${fmtInt(result.contextLength)}` : null,
      result.batchSize != null ? `batch ${result.batchSize}` : null,
    ].filter(Boolean)
    return (
      <span className={cn('text-muted-foreground', className)}>
        {part === 'all' ? 'Conditions not recorded' : 'Not recorded'}
        {legacy.length ? <span className="block text-xs">Legacy fields: {legacy.join(', ')}</span> : null}
      </span>
    )
  }
  const chips = part === 'workload' ? workloadChips(result) : part === 'method' ? methodChips(result) : part === 'compact' ? compactChips(result) : conditionChips(result)
  if (!chips.length) return <span className={cn('text-muted-foreground', className)}>—</span>
  return (
    <span className={cn('flex flex-wrap gap-1', className)}>
      {chips.map((chip) => (
        <Badge key={chip} variant="outline" className="font-mono font-normal">{chip}</Badge>
      ))}
    </span>
  )
}

/** The named setup a result ranks in, as a tag; nothing when it matches none. */
export function SetupTag({ result }: { result: Partial<Conditions> }) {
  const setup = setupOf(result)
  return setup ? <Badge variant="outline" className="border-verified/40 text-verified">{setup.name}</Badge> : null
}

/** One board cell: the setup tag (on mixed boards) followed by the compact conditions. */
export function ConditionsCell({ result, showSetup }: { result: Partial<Conditions>; showSetup?: boolean }) {
  return (
    <span className="flex min-w-[220px] max-w-[300px] flex-wrap items-center gap-1">
      {showSetup ? <SetupTag result={result} /> : null}
      <ConditionChips result={result} part="compact" className="contents" />
    </span>
  )
}
