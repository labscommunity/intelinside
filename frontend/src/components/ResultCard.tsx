import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink } from 'lucide-react'
import { Cell, CellGrid, Framed, inset } from '@/components/frame'
import { RuntimeBadge } from '@/components/RuntimeBadge'
import { ExecutionBadge } from '@/components/ExecutionBadge'
import { CustomRuntimeLink } from '@/components/CustomRuntimeLink'
import { VerificationBadge } from '@/components/VerificationBadge'
import { UserLink } from '@/components/UserLink'
import { HardwareLink } from '@/components/HardwareLink'
import { UnitLabel } from '@/components/UnitLabel'
import { ConditionChips } from '@/components/ConditionChips'
import type { Model, Quant, Result, ResultRank, Runtime } from '@/lib/api/types'
import { fmtDate, fmtMs, fmtTps } from '@/lib/format'
import { boardPhrase, rankBoardPath, unitPhrase } from '@/lib/rank'
import { cn } from '@/lib/utils'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Cell className="py-5 md:py-5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm">{children}</div>
    </Cell>
  )
}

type Props = {
  result: Result
  models: Model[]
  quants: Quant[]
  runtimes: Runtime[]
  rank?: ResultRank
  /** Shown top-left instead of "Decode speed", for example "Preview". */
  eyebrow?: string
  /** Tighter layout for a side column: two field columns and a smaller figure. */
  compact?: boolean
  /** Buttons for the bottom-right corner of the figure block, under the verification badge. */
  actions?: ReactNode
  footer?: ReactNode
}

/** The result as a framed block: figure, rank, fields, notes. Used by the result page and the submit preview. */
export function ResultCard({ result: r, models, quants, runtimes, rank, eyebrow = 'Decode speed', compact = false, actions, footer }: Props) {
  const model = models.find((m) => m.id === r.modelId)
  const quant = quants.find((q) => q.id === r.quant)?.label ?? r.quant
  const runtime = runtimes.find((x) => x.id === r.runtimeId)
  const hasFigure = Number.isFinite(r.decodeTps) && r.decodeTps > 0
  return (
    <Framed padded={false}>
      <div className={cn('flex flex-wrap items-start justify-between gap-6', compact ? 'py-8' : 'py-10 md:py-14', inset)}>
        <div>
          <div className="text-xs font-medium uppercase tracking-label text-muted-foreground">{eyebrow}</div>
          <div className={cn('mt-2 font-mono font-semibold tnum', compact ? 'text-5xl' : 'text-6xl md:text-7xl')}>
            {hasFigure ? fmtTps(r.decodeTps) : '—'} <span className={cn('font-normal text-muted-foreground', compact ? 'text-lg' : 'text-2xl')}>tok/s</span>
          </div>
          {rank?.position ? (
            <Link to={rankBoardPath(r, rank)} className="mt-3 inline-block text-sm text-muted-foreground hover:text-foreground">
              #{rank.position} of {rank.boardSize} {boardPhrase(rank, model?.name ?? r.modelId, quant)}
            </Link>
          ) : rank?.heldBy ? (
            <p className="mt-3 max-w-prose text-sm text-muted-foreground">
              Not ranked. {unitPhrase(r)} holds #{rank.heldBy.position} of {rank.boardSize} with{' '}
              <Link to={`/results/${rank.heldBy.id}`} className="text-foreground underline-offset-4 hover:underline">a faster result</Link>; the board shows each {r.component ? 'part' : 'rig'} once.
            </p>
          ) : null}
        </div>
        <div className="flex flex-col items-end justify-between gap-6 self-stretch">
          <VerificationBadge verification={r.verification} moderation={r.moderation} className="h-6 px-2.5" />
          {actions ? <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div> : null}
        </div>
      </div>
      <CellGrid cols={compact ? 2 : 3} className={cn('border-t', !r.notes && !footer && 'border-b')}>
        <Field label="Model">
          {model ? (
            <>
              <Link to={`/models/${r.modelId}/${r.quant}`} className="hover:underline underline-offset-4">{model.name}</Link>
              <span className="ml-1.5 font-mono text-xs text-muted-foreground">{quant}</span>
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </Field>
        <Field label={r.component ? 'Part' : 'Rig'}>
          {r.component ? (
            <>
              <HardwareLink hardware={r.component} quantity={r.componentQuantity} />
              <div className="mt-0.5 text-xs text-muted-foreground">
                <UnitLabel hardware={r.component} host={r.componentHost} />
              </div>
            </>
          ) : r.rig ? (
            <Link to={`/rigs/${r.rigId}`} className="hover:underline underline-offset-4">{r.rig.name}</Link>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </Field>
        {r.component ? (
          <Field label="In rig">{r.rig ? <Link to={`/rigs/${r.rigId}`} className="hover:underline underline-offset-4">{r.rig.name}</Link> : '—'}</Field>
        ) : (
          <Field label="Summary">{r.rig?.summary ?? '—'}</Field>
        )}
        <Field label="Runtime">
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <RuntimeBadge runtime={runtime} version={r.runtimeVersion || undefined} />
            <ExecutionBadge result={r} />
          </span>
          {r.runtimeFlags ? <div className="mt-0.5 font-mono text-xs text-muted-foreground text-pretty">{r.runtimeFlags}</div> : null}
        </Field>
        {/* Always present, so the grid is a full 12 cells either way — 4 rows at three columns, 6 at two — and a
            stock run answers the question rather than staying silent about it. */}
        <Field label="Custom runtime">
          {r.customRuntime ? (
            <>
              <CustomRuntimeLink build={r.customRuntime} />
              {r.revision ? <div className="mt-0.5 font-mono text-xs text-muted-foreground">@ {r.revision}</div> : null}
            </>
          ) : (
            <>
              <span className="text-muted-foreground">Stock</span>
              {r.revision ? <div className="mt-0.5 font-mono text-xs text-muted-foreground">@ {r.revision}</div> : null}
            </>
          )}
        </Field>
        <Field label="Prompt tok/s"><span className="font-mono tnum">{fmtTps(r.promptTps)}</span></Field>
        <Field label="Time to first token"><span className="font-mono tnum">{fmtMs(r.ttftMs)}</span></Field>
        {/* Two cells in place of context length and batch size, so the grid stays 12 cells. */}
        <Field label="Workload"><ConditionChips result={r} part="workload" /></Field>
        <Field label="Method"><ConditionChips result={r} part="method" /></Field>
        <Field label="Run date">{r.runDate ? fmtDate(r.runDate) : '—'}</Field>
        <Field label="Submitted by"><UserLink user={r.submitter} /></Field>
        <Field label="Evidence">
          {r.repoUrl && r.repoUrl !== r.sourcePrUrl ? (
            <a href={r.repoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 break-all hover:underline underline-offset-4">
              {r.repoUrl.replace(/^https?:\/\//, '').slice(0, 40)}
              <ExternalLink className="size-3 shrink-0" />
            </a>
          ) : null}
          {r.sourcePrUrl ? (
            <a href={r.sourcePrUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-muted-foreground hover:underline underline-offset-4">
              Submission PR <ExternalLink className="size-3 shrink-0" />
            </a>
          ) : null}
          {!r.repoUrl && !r.sourcePrUrl ? <span className="text-muted-foreground">—</span> : null}
        </Field>
      </CellGrid>
      {r.notes ? <p className={cn('border-t py-5 text-sm text-pretty', inset)}>{r.notes}</p> : null}
      {footer ? <div className={cn('flex flex-wrap items-center gap-3 border-t py-5', inset)}>{footer}</div> : null}
    </Framed>
  )
}
