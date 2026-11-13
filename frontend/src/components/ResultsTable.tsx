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
import type { Model, Quant, Result, Runtime } from '@/lib/api/types'
import { fmtDate, fmtMs, fmtTps } from '@/lib/format'

type Props = {
  results: Result[]
  runtimes: Runtime[]
  models: Model[]
  quants: Quant[]
  showHardware?: boolean
  showSubmitter?: boolean
  /** Add a Conditions column; with `showSetup`, also tag each row with the named setup it ranks in. */
  conditions?: boolean
  showSetup?: boolean
}

/** Plain results list used on hardware, rig, and profile pages. Not ranked. */
export function ResultsTable({ results, runtimes, models, quants, showHardware = true, showSubmitter = true, conditions, showSetup }: Props) {
  const navigate = useNavigate()
  const rt = Object.fromEntries(runtimes.map((r) => [r.id, r]))
  const md = Object.fromEntries(models.map((m) => [m.id, m]))
  const qt = Object.fromEntries(quants.map((q) => [q.id, q]))
  return (
    <div className="overflow-x-auto">
      <Table className={cn(conditions ? 'min-w-[1000px]' : 'min-w-[780px]')}>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={th}>Model</TableHead>
            {showHardware ? <TableHead className={th}>Ran on</TableHead> : null}
            <TableHead className={th}>Runtime</TableHead>
            <TableHead className={`${th} text-right`}>Decode tok/s</TableHead>
            {conditions ? <TableHead className={th}>Conditions</TableHead> : null}
            <TableHead className={`${th} hidden text-right md:table-cell`}>Prompt tok/s</TableHead>
            <TableHead className={`${th} hidden text-right lg:table-cell`}>TTFT</TableHead>
            {showSubmitter ? <TableHead className={th}>By</TableHead> : null}
            <TableHead className={th}>Status</TableHead>
            <TableHead className={`${th} hidden text-right md:table-cell`}>Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {results.map((r) => (
            <TableRow key={r.id} className="cursor-pointer" onClick={() => navigate(`/results/${r.id}`)}>
              <TableCell className={td}>
                <Link to={`/models/${r.modelId}/${r.quant}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline underline-offset-4">
                  {md[r.modelId]?.name ?? r.modelId}
                </Link>
                <span className="ml-1.5 font-mono text-xs text-muted-foreground">{qt[r.quant]?.label ?? r.quant}</span>
              </TableCell>
              {showHardware ? (
                <TableCell className={`${td} max-w-[280px]`}>
                  {r.component ? (
                    <div className="min-w-0">
                      <HardwareLink hardware={r.component} quantity={r.componentQuantity} />
                      <div className="truncate text-xs text-muted-foreground">
                        <UnitLabel hardware={r.component} host={r.componentHost} /> · in {r.rig?.name}
                      </div>
                    </div>
                  ) : (
                    <div className="min-w-0">
                      <Link to={`/rigs/${r.rigId}`} onClick={(e) => e.stopPropagation()} className="hover:underline underline-offset-4">
                        {r.rig?.name ?? 'Rig'}
                      </Link>
                      <div className="truncate text-xs text-muted-foreground">whole rig</div>
                    </div>
                  )}
                </TableCell>
              ) : null}
              <TableCell className={td}>
                <span className="inline-flex items-center gap-1 whitespace-nowrap"><RuntimeBadge runtime={rt[r.runtimeId]} version={r.runtimeVersion} />{r.customRuntime ? <CustomRuntimeLink build={r.customRuntime} className="text-xs" /> : <ExecutionBadge result={r} iconOnly />}</span>
              </TableCell>
              <TableCell className={`${td} text-right font-mono text-base font-medium tnum`}>
                <Link to={`/results/${r.id}`} onClick={(e) => e.stopPropagation()} className="rounded-sm hover:underline underline-offset-4" aria-label={`${fmtTps(r.decodeTps)} tokens per second, open result`}>
                  {fmtTps(r.decodeTps)}
                </Link>
              </TableCell>
              {conditions ? <TableCell className={`${td} text-xs`}><ConditionsCell result={r} showSetup={showSetup} /></TableCell> : null}
              <TableCell className={`${td} hidden text-right font-mono text-muted-foreground tnum md:table-cell`}>{fmtTps(r.promptTps)}</TableCell>
              <TableCell className={`${td} hidden text-right font-mono text-muted-foreground tnum lg:table-cell`}>{fmtMs(r.ttftMs)}</TableCell>
              {showSubmitter ? (
                <TableCell className={td}>
                  <UserLink user={r.submitter} />
                </TableCell>
              ) : null}
              <TableCell className={td}>
                <VerificationBadge verification={r.verification} moderation={r.moderation} />
              </TableCell>
              <TableCell className={`${td} hidden text-right text-xs text-muted-foreground md:table-cell`}>{fmtDate(r.runDate)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
