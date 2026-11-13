import { Link, useNavigate } from 'react-router-dom'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { RuntimeBadge } from '@/components/RuntimeBadge'
import { ExecutionBadge } from '@/components/ExecutionBadge'
import { CustomRuntimeLink } from '@/components/CustomRuntimeLink'
import { VerificationBadge } from '@/components/VerificationBadge'
import { UserLink } from '@/components/UserLink'
import { HardwareLink } from '@/components/HardwareLink'
import { UnitLabel } from '@/components/UnitLabel'
import { td, th } from '@/components/table-styles'
import { ConditionsCell } from '@/components/ConditionChips'
import { cn } from '@/lib/utils'
import type { BoardRow, Model, Quant, Runtime } from '@/lib/api/types'
import { fmtDate, fmtMs, fmtTps } from '@/lib/format'

type Props = {
  rows: BoardRow[]; runtimes: Runtime[]; models?: Model[]; quants?: Quant[]
  /** Add a Conditions column; with `showSetup`, also tag each row with the named setup it ranks in. */
  conditions?: boolean; showSetup?: boolean
}

/** Ranked rows. Pass `models` and `quants` to add a Model column for cross-board lists. */
export function LeaderboardTable({ rows, runtimes, models, quants, conditions, showSetup }: Props) {
  const navigate = useNavigate()
  const byId = Object.fromEntries(runtimes.map((r) => [r.id, r]))
  const showModel = !!models
  const md = Object.fromEntries((models ?? []).map((m) => [m.id, m]))
  const qt = Object.fromEntries((quants ?? []).map((q) => [q.id, q]))
  return (
    <div className="overflow-x-auto">
      <Table className={cn(conditions ? 'min-w-[1040px]' : 'min-w-[820px]')}>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={`${th} w-16 text-right`}>#</TableHead>
            <TableHead className={th}>Hardware</TableHead>
            {showModel ? <TableHead className={th}>Model</TableHead> : null}
            <TableHead className={th}>Runtime</TableHead>
            <TableHead className={`${th} text-right`}>Decode tok/s</TableHead>
            {conditions ? <TableHead className={th}>Conditions</TableHead> : null}
            <TableHead className={`${th} hidden text-right md:table-cell`}>Prompt tok/s</TableHead>
            <TableHead className={`${th} hidden text-right lg:table-cell`}>TTFT</TableHead>
            <TableHead className={th}>By</TableHead>
            <TableHead className={th}>Status</TableHead>
            <TableHead className={`${th} hidden text-right lg:table-cell`}>Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ rank, result, unit }) => (
            <TableRow key={result.id} className="cursor-pointer" onClick={() => navigate(`/results/${result.id}`)}>
              <TableCell className={`${td} text-right font-mono text-muted-foreground tnum`}>{rank}</TableCell>
              <TableCell className={`${td} max-w-[340px]`}>
                {unit.kind === 'rig' ? (
                  <div className="min-w-0">
                    <Link to={`/rigs/${unit.rig.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline underline-offset-4">
                      {unit.rig.name}
                    </Link>
                    <div className="truncate text-xs text-muted-foreground">{unit.rig.summary}</div>
                  </div>
                ) : (
                  <div className="min-w-0">
                    <HardwareLink hardware={unit.hardware} quantity={unit.quantity} className="font-medium" />
                    <div className="truncate text-xs text-muted-foreground">
                      <UnitLabel hardware={unit.hardware} host={result.componentHost} prefix={unit.hardware.vendor === 'Generic' ? undefined : unit.hardware.vendor} /> · in{' '}
                      {result.rig?.name}
                    </div>
                  </div>
                )}
              </TableCell>
              {showModel ? (
                <TableCell className={td}>
                  <Link to={`/models/${result.modelId}/${result.quant}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline underline-offset-4">
                    {md[result.modelId]?.name ?? result.modelId}
                  </Link>
                  <span className="ml-1.5 font-mono text-xs text-muted-foreground">{qt[result.quant]?.label ?? result.quant}</span>
                </TableCell>
              ) : null}
              <TableCell className={td}>
                <span className="inline-flex items-center gap-1 whitespace-nowrap">
                  <RuntimeBadge runtime={byId[result.runtimeId]} version={result.runtimeVersion} />
                  {result.customRuntime ? <CustomRuntimeLink build={result.customRuntime} className="text-xs" /> : <ExecutionBadge result={result} iconOnly />}
                </span>
              </TableCell>
              <TableCell className={`${td} text-right font-mono text-base font-medium tnum`}>
                <Link to={`/results/${result.id}`} onClick={(e) => e.stopPropagation()} className="rounded-sm hover:underline underline-offset-4" aria-label={`${fmtTps(result.decodeTps)} tokens per second, open result`}>
                  {fmtTps(result.decodeTps)}
                </Link>
              </TableCell>
              {conditions ? <TableCell className={`${td} text-xs`}><ConditionsCell result={result} showSetup={showSetup} /></TableCell> : null}
              <TableCell className={`${td} hidden text-right font-mono text-muted-foreground tnum md:table-cell`}>{fmtTps(result.promptTps)}</TableCell>
              <TableCell className={`${td} hidden text-right font-mono text-muted-foreground tnum lg:table-cell`}>{fmtMs(result.ttftMs)}</TableCell>
              <TableCell className={td}>
                <UserLink user={result.submitter} />
              </TableCell>
              <TableCell className={td}>
                <VerificationBadge verification={result.verification} />
              </TableCell>
              <TableCell className={`${td} hidden text-right text-xs text-muted-foreground lg:table-cell`}>{fmtDate(result.runDate)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
