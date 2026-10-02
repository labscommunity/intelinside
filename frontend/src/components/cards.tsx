import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { RigPhoto } from '@/components/RigPhoto'
import { ShareIconButton } from '@/components/ShareIconButton'
import { UserAvatar } from '@/components/UserAvatar'
import { HardwareTypeIcon } from '@/components/HardwareTypeIcon'
import { ModelLogo } from '@/components/ModelLogo'
import { VendorMark } from '@/components/VendorMark'
import type { BoardMeta, HardwareItem, Model, ModelSummary, RigSummary, Runtime } from '@/lib/api/types'
import { RuntimeMark } from '@/components/RuntimeMark'
import { GhostList } from '@/components/empty'
import { HARDWARE_TYPE_LABEL, QUANT_BY_ID, quantHint } from '@/catalog'
import { UNIT_LABEL, integratedParts } from '@/lib/hardware'
import { fmtTps, pluralize } from '@/lib/format'
import { rigShareTarget } from '@/lib/share'
import { cn } from '@/lib/utils'

// Grid cells, not floating cards: each paints its own background so CellGrid's hairlines show between them.
const cell = 'group flex min-w-0 flex-col gap-4 bg-background p-6 transition-colors hover:bg-card focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-inset focus-visible:outline-none md:p-7'

function More({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-sm font-medium">
      {children}
      <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
    </span>
  )
}

/**
 * The share icon sits over the photo as a sibling of the link, not inside it, so its modal never triggers navigation.
 * It shows on hover and keyboard focus, and always on touch screens.
 */
export function RigCard({ rig }: { rig: RigSummary }) {
  return (
    <div className="group relative flex min-w-0 bg-background">
    <Link to={`/rigs/${rig.id}`} className={cn(cell, 'flex-1')}>
      <div className="aspect-[16/10] overflow-hidden rounded-xl">
        <RigPhoto id={rig.id} photoUrl={rig.photoUrl} alt={rig.name} components={rig.components} />
      </div>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span className="inline-flex items-center gap-2">
          <UserAvatar user={rig.owner} size="sm" /> {rig.owner?.handle}
        </span>
        <span>{pluralize(rig.resultsCount, 'result')}</span>
      </div>
      <div>
        <h3 className="text-lg font-semibold">{rig.name}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{rig.summary}</p>
      </div>
      <div className="mt-auto flex items-center justify-between pt-2">
        <span className="font-mono text-sm tnum">{rig.bestTps != null ? `${fmtTps(rig.bestTps)} tok/s` : 'No results yet'}</span>
        <More>View rig</More>
      </div>
    </Link>
    <ShareIconButton
      target={rigShareTarget(rig, rig.bestTps != null ? { tps: rig.bestTps } : undefined)}
      className="absolute top-8 right-8 size-7 rounded-md bg-background/80 opacity-0 backdrop-blur-xs transition-opacity group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 md:top-9 md:right-9 [@media(hover:none)]:opacity-100 [&_svg:not([class*='size-'])]:size-3.5"
    />
    </div>
  )
}

export function keySpec(h: HardwareItem): string {
  const s = h.specs
  switch (h.type) {
    case 'cpu':
      return `${s.cores} cores · ${s.boostGhz} GHz`
    case 'gpu':
      return `${s.vramGb} GB ${s.memoryType}${s.tdpW ? ` · ${s.tdpW} W` : ''}`
    case 'igpu':
      return s.xeCores ? `${s.xeCores} Xe cores · ${s.platform}` : `${s.cores ?? s.euCount} cores · ${s.platform}`
    case 'npu':
      return `${s.tops} TOPS · ${s.platform}`
    case 'ram':
      return `${s.capacityGb} GB · ${s.speedMts} MT/s · ${s.formFactor}`
  }
}

/** `counts={false}` shows the series instead of result and rig counts, for launch week. */
export function HardwareCard({ hardware, counts = true }: { hardware: HardwareItem; counts?: boolean }) {
  const integrated = integratedParts(hardware)
  return (
    <Link to={`/hardware/${hardware.id}`} className={cell}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <HardwareTypeIcon type={hardware.type} className="size-3.5" />
        {HARDWARE_TYPE_LABEL[hardware.type]}
        <VendorMark vendor={hardware.vendor} className="ml-auto" />
      </div>
      <div>
        <h3 className="text-lg font-semibold">{hardware.name}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{keySpec(hardware)}</p>
        {integrated.length ? (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {integrated.map((part) => (
              <span key={part.id} className="inline-flex items-center gap-1">
                <HardwareTypeIcon type={part.type} className="size-3" /> {UNIT_LABEL[part.type]}
              </span>
            ))}
            <span>on the package</span>
          </p>
        ) : null}
      </div>
      <div className="mt-auto flex items-center justify-between pt-2 text-sm text-muted-foreground">
        <span>
          {counts ? (
            <>
              {pluralize(hardware.resultsCount ?? 0, 'result')} · {pluralize(hardware.rigsCount ?? 0, 'rig')}
            </>
          ) : (
            hardware.series
          )}
        </span>
        <More>View</More>
      </div>
    </Link>
  )
}

/** The board page for a summary's board: the rigs board is the page's default, the components board is a query. */
export const boardPath = (board: Pick<BoardMeta, 'modelId' | 'quant' | 'kind'>) => `/models/${board.modelId}/${board.quant}${board.kind === 'components' ? '?kind=components' : ''}`

/** One chip per quant, with total submissions across both boards. `lit` picks the chips drawn in full ink. */
export function QuantChips({ model, lit, className }: { model: Model; lit: (quant: string) => boolean; className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {model.quants.map((q) => (
        <Link
          key={q}
          to={`/models/${model.id}/${q}`}
          title={`${quantHint(q)} · ${model.resultCounts?.[q] ?? 0} total submissions across rigs and components`}
          className={cn(
            'rounded-md border px-2 py-1 font-mono text-xs whitespace-nowrap transition-colors hover:border-foreground/30 hover:text-foreground',
            lit(q) ? 'border-foreground/30 text-foreground' : 'text-muted-foreground',
          )}
        >
          {QUANT_BY_ID[q]?.label ?? q}
          <span className="opacity-60"> {model.resultCounts?.[q] ?? 0}</span>
        </Link>
      ))}
    </div>
  )
}

/** An empty board keeps its shape and asks for the first result rather than hiding. */
export function ModelBoardCard({ summary, runtimes }: { summary: ModelSummary; runtimes: Record<string, Runtime> }) {
  const { model, board, top } = summary
  const empty = top.length === 0
  const total = Object.values(model.resultCounts ?? {}).reduce((a, b) => a + b, 0)
  const boardHref = boardPath(board)
  return (
    <div className={cn(cell, 'hover:bg-background')}>
      <div className="flex items-start gap-3">
        <ModelLogo model={model} />
        <div className="min-w-0">
          <div className="text-sm text-muted-foreground">
            {model.family} · {model.params}
            {model.architecture === 'moe' ? ` · MoE, ${model.activeParams} active` : ''}
            {` · ${pluralize(total, 'result')}`}
          </div>
          <h3 className="mt-0.5 text-lg font-semibold">
            <Link to={boardHref} className="hover:underline underline-offset-4">
              {model.name}
            </Link>
          </h3>
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-xs font-medium uppercase tracking-label text-muted-foreground">Quantization</div>
        <QuantChips model={model} lit={(q) => q === board.quant} />
      </div>
      <div>
        <div className="text-xs font-medium uppercase tracking-label text-muted-foreground">
          <span className="font-mono normal-case tracking-normal">{QUANT_BY_ID[board.quant]?.label ?? board.quant}</span> · {board.kind} · {`${board.total} ranked`}
        </div>
        {/* An empty tile keeps the shape of the three rows it will hold rather than collapsing to one grey line. */}
        {empty ? (
          <GhostList />
        ) : (
          <ol className="mt-1 divide-y">
            {top.map((row) => (
              <li key={row.result.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="w-4 font-mono text-xs text-muted-foreground tnum">{row.rank}</span>
                <Link to={`/results/${row.result.id}`} className="min-w-0 flex-1 truncate hover:underline underline-offset-4">
                  {row.unit.kind === 'rig' ? row.unit.rig.name : row.unit.hardware.name}
                </Link>
                <RuntimeMark runtime={runtimes[row.result.runtimeId]} size="sm" />
                <span className="font-mono tnum">{fmtTps(row.result.decodeTps)}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 pt-1">
        {/* An empty board leads with the way to fill it; a live one leads with the board itself. */}
        {empty ? (
          <Link to={`/submit?model=${model.id}&quant=${board.quant}`} className="group/link inline-flex items-center gap-1 text-sm font-medium text-foreground hover:underline underline-offset-4">
            Submit a result <ChevronRight className="size-3.5 transition-transform group-hover/link:translate-x-0.5" />
          </Link>
        ) : null}
        <Link
          to={boardHref}
          className={cn('group/link inline-flex items-center gap-1 text-sm font-medium hover:underline underline-offset-4', empty ? 'text-muted-foreground hover:text-foreground' : 'text-foreground')}
        >
          Full board <ChevronRight className="size-3.5 transition-transform group-hover/link:translate-x-0.5" />
        </Link>
      </div>
    </div>
  )
}
