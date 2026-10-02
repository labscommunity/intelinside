import { useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { BarChart3, ExternalLink, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { PageHeader } from '@/components/PageHeader'
import { LeaderboardTable } from '@/components/LeaderboardTable'
import { ResultsTable } from '@/components/ResultsTable'
import { TpsBarChart } from '@/components/TpsBarChart'
import { RuntimeMark } from '@/components/RuntimeMark'
import { ModelLogo } from '@/components/ModelLogo'
import { EmptyBoard } from '@/components/empty'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { LoadMore } from '@/components/LoadMore'
import { Block, Framed, PillTabs, Section, Toolbar, inset } from '@/components/frame'
import { useAsync } from '@/hooks/useAsync'
import { useCatalog } from '@/hooks/useCatalog'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useSession } from '@/hooks/useSession'
import { api } from '@/lib/api'
import type { BoardKind, HardwareType, VerificationStatus } from '@/lib/api/types'
import { HARDWARE_TYPE_LABEL, HARDWARE_TYPES, QUANT_BY_ID, VENDORS, quantHint } from '@/catalog'
import { cn } from '@/lib/utils'

const ALL = 'all'
const vendorItems = [{ value: ALL, label: 'All vendors' }, ...VENDORS.map((v) => ({ value: v, label: v }))]
const typeItems = [{ value: ALL, label: 'All types' }, ...HARDWARE_TYPES.map((t) => ({ value: t, label: HARDWARE_TYPE_LABEL[t] }))]
const verificationItems = [
  { value: ALL, label: 'Any status' },
  { value: 'community_verified', label: 'Verified only' },
  { value: 'self_reported', label: 'Self-reported only' },
]

export default function Board() {
  const { modelId = '', quant } = useParams()
  const [sp, setSp] = useSearchParams()
  const cat = useCatalog()
  const { user, requestSignIn } = useSession()
  const model = cat.data?.models.find((m) => m.id === modelId)

  const kind = (sp.get('kind') as BoardKind) || 'rigs'
  const allSubmissions = sp.get('view') === 'submissions'
  const runtime = sp.get('runtime')?.split(',').filter(Boolean) ?? []
  const vendor = sp.get('vendor') ?? ''
  const type = sp.get('type') ?? ''
  const verification = sp.get('verification') ?? ''
  // Off by default: the board is a hardware comparison, so a changed runtime is opt-in rather than mixed in.
  const includeModified = sp.get('modified') === '1'
  const q = sp.get('q') ?? ''
  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(sp)
    for (const [k, v] of Object.entries(patch)) {
      if (!v || v === ALL) next.delete(k)
      else next.set(k, v)
    }
    setSp(next, { replace: true })
  }
  const params = {
    kind,
    allSubmissions,
    runtime,
    vendor: vendor || undefined,
    type: (type || undefined) as HardwareType | undefined,
    verification: (verification || undefined) as VerificationStatus | undefined,
    includeModified,
    q: q || undefined,
  }

  const quantLabel = quant ? QUANT_BY_ID[quant]?.label ?? quant : ''
  usePageTitle(model ? `${model.name} ${quantLabel}` : 'Board')

  // Keep both boards ready so changing tabs does not refetch or clear their counts.
  const rigsBoard = useAsync(
    () => (quant ? api.board(modelId, quant, { ...params, kind: 'rigs', type: undefined }) : Promise.reject(new Error('no quant'))),
    [modelId, quant, allSubmissions, runtime.join(','), vendor, verification, includeModified, q],
  )
  const componentsBoard = useAsync(
    () => (quant ? api.board(modelId, quant, { ...params, kind: 'components' }) : Promise.reject(new Error('no quant'))),
    [modelId, quant, allSubmissions, runtime.join(','), vendor, type, verification, includeModified, q],
  )
  const board = kind === 'rigs' ? rigsBoard : componentsBoard
  const otherKind: BoardKind = kind === 'rigs' ? 'components' : 'rigs'
  const otherBoard = kind === 'rigs' ? componentsBoard : rigsBoard
  const otherCount = otherBoard.loading || otherBoard.error ? undefined : otherBoard.data?.board.total
  const counts = {
    rigs: rigsBoard.error ? undefined : rigsBoard.data?.board.total,
    components: componentsBoard.error ? undefined : componentsBoard.data?.board.total,
  }
  const [showChart, setShowChart] = useState(false)

  if (!quant) {
    if (cat.loading)
      return (
        <Block>
          <Skeleton className="h-40" />
        </Block>
      )
    if (!model)
      return (
        <Block>
          <ErrorState error={new Error('No such model.')} />
        </Block>
      )
    const best = model.quants.slice().sort((a, b) => (model.resultCounts?.[b] ?? 0) - (model.resultCounts?.[a] ?? 0))[0]
    return <Navigate replace to={`/models/${model.id}/${best}`} />
  }

  const rows = board.data?.items ?? []
  const cursor = board.data?.nextCursor
  const runtimes = cat.data?.runtimes ?? []
  const filtered = runtime.length > 0 || !!vendor || !!type || !!verification || !!q
  const submit = user ? (
    <Button render={<Link to={`/submit?model=${modelId}&quant=${quant}`} />} nativeButton={false}>
      Submit a result
    </Button>
  ) : (
    <Button onClick={() => requestSignIn('/submit')}>Submit a result</Button>
  )

  return (
    <div>
      <PageHeader
        eyebrow={model ? `${model.family} · ${model.params}${model.architecture === 'moe' ? ` · MoE, ${model.activeParams} active` : ''}` : 'Board'}
        title={
          <span className="inline-flex flex-wrap items-center gap-x-3">
            {model ? <ModelLogo model={model} size="lg" /> : null}
            {model?.name ?? modelId}
            <span className="font-mono text-xl">{quantLabel}</span>
          </span>
        }
        actions={
          <>
            {model ? (
              <Button variant="ghost" render={<a href={model.sourceUrl} target="_blank" rel="noreferrer" />} nativeButton={false}>
                Model card <ExternalLink data-icon="inline-end" />
              </Button>
            ) : null}
            {submit}
          </>
        }
      >
        {model ? (
          <div className="mt-5">
            <div className="mb-1.5 text-xs font-medium uppercase tracking-label text-muted-foreground">Quantization</div>
            <PillTabs
              className="-ml-3"
              value={quant}
              items={model.quants.map((qid) => ({
                value: qid,
                label: <span className="font-mono">{QUANT_BY_ID[qid]?.label ?? qid}</span>,
                count: model.resultCounts?.[qid] ?? 0,
                to: `/models/${model.id}/${qid}${sp.toString() ? `?${sp}` : ''}`,
                hint: `${quantHint(qid)} · ${model.resultCounts?.[qid] ?? 0} total submissions across rigs and components`,
              }))}
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Quantization counts include all submissions across rigs and components, before filters.
              Each leaderboard ranks only the best entry per rig or component and quantity.
              Choose All submissions to see every matching run on the selected board.
            </p>
          </div>
        ) : null}
      </PageHeader>

      <Section>
        <Toolbar>
          <PillTabs
            className="-ml-3"
            value={allSubmissions ? 'submissions' : 'leaderboard'}
            onChange={(v) => update({ view: v === 'submissions' ? v : undefined })}
            items={[
              { value: 'leaderboard', label: 'Leaderboard' },
              { value: 'submissions', label: 'All submissions' },
            ]}
          />
          <span className="text-xs text-muted-foreground">
            {allSubmissions ? 'Every matching submission, fastest first' : 'Best entry per rig or component and quantity'}
          </span>
        </Toolbar>
        <Toolbar>
          <PillTabs<BoardKind>
            className="-ml-3"
            value={kind}
            onChange={(v) => update({ kind: v, type: undefined })}
            items={[
              { value: 'rigs', label: 'Rigs', count: counts.rigs, hint: allSubmissions ? 'Rig submissions matching the filters' : 'Ranked rigs matching the filters' },
              { value: 'components', label: 'Components', count: counts.components, hint: allSubmissions ? 'Component submissions matching the filters' : 'Ranked component and quantity combinations matching the filters' },
            ]}
          />
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => update({ q: e.target.value })} placeholder="Search hardware or people" className="w-56 pl-8" />
          </div>
          <Select value={vendor || ALL} onValueChange={(v) => update({ vendor: String(v) })} items={vendorItems}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>{vendorItems.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent>
          </Select>
          {kind === 'components' ? (
            <Select value={type || ALL} onValueChange={(v) => update({ type: String(v) })} items={typeItems}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>{typeItems.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent>
            </Select>
          ) : null}
          <Select value={verification || ALL} onValueChange={(v) => update({ verification: String(v) })} items={verificationItems}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>{verificationItems.map((i) => <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>)}</SelectContent>
          </Select>
          <label className="flex items-center gap-2 whitespace-nowrap text-sm text-muted-foreground">
            <Switch
              checked={includeModified}
              onCheckedChange={(on) => update({ modified: on ? '1' : undefined })}
              aria-label="Include results from modified runtimes"
            />
            Include modified
          </label>
          {!allSubmissions ? <Button variant="outline" size="sm" className="md:hidden" onClick={() => setShowChart((s) => !s)}>
            <BarChart3 data-icon="inline-start" /> {showChart ? 'Hide chart' : 'Chart'}
          </Button> : null}
        </Toolbar>
        <Toolbar>
          <ToggleGroup multiple value={runtime} onValueChange={(v) => update({ runtime: (v as string[]).join(',') })} variant="outline" size="sm" className="flex-wrap">
            {runtimes.map((r) => (
              <ToggleGroupItem key={r.id} value={r.id} aria-label={r.name}>
                <RuntimeMark runtime={r} size="sm" /> {r.name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Toolbar>

        {board.error ? (
          <Block>
            <ErrorState error={board.error} />
          </Block>
        ) : null}

        {board.loading ? (
          <Block className="space-y-4">
            <Skeleton className="h-64" />
            <Skeleton className="h-96" />
          </Block>
        ) : board.data ? (
          rows.length ? (
            <>
              {!allSubmissions ? <div className={cn(showChart ? 'block' : 'hidden md:block', 'border-b')}>
                <Framed>
                  <TpsBarChart bars={board.data.chart} runtimes={runtimes} />
                </Framed>
              </div> : null}
              <div className={cn('border-b py-2.5 text-xs text-muted-foreground', inset)}>
                {allSubmissions
                  ? `${board.data.board.total} ${kind === 'rigs' ? 'rig' : 'component'} submissions · fastest first · filters apply`
                  : `${board.data.board.total} ${kind} ranked · best entry per ${kind === 'rigs' ? 'rig' : 'part and quantity'} · earliest run wins ties`}
              </div>
              {allSubmissions ? (
                <ResultsTable results={rows.map((row) => row.result)} runtimes={runtimes} models={cat.data?.models ?? []} quants={cat.data?.quants ?? []} />
              ) : <LeaderboardTable rows={rows} runtimes={runtimes} />}
              {cursor ? (
                <Block className="py-4">
                  <LoadMore
                    hasMore={!!cursor}
                    onLoad={async () => {
                      const previous = board.data
                      const page = await api.board(modelId, quant, { ...params, cursor })
                      board.setData((current) => current && current === previous
                        ? { ...current, items: [...current.items, ...page.items], nextCursor: page.nextCursor }
                        : current!)
                    }}
                  />
                </Block>
              ) : null}
            </>
          ) : (
            // A filter that matches nothing is not an empty board, so it keeps the plain message.
            (otherCount ?? 0) > 0 ? (
              <EmptyState
                title={`No matching entries on the ${kind} board`}
                description={`${otherCount} ${allSubmissions ? (otherCount === 1 ? 'submission is' : 'submissions are') : (otherCount === 1 ? 'ranked entry is' : 'ranked entries are')} available on the ${otherKind} board.`}
                action={
                  <Button onClick={() => update({ kind: otherKind, type: undefined })}>
                    View {otherKind}
                  </Button>
                }
              />
            ) : filtered ? (
              <EmptyState
                title={`Nothing matches on the ${model?.name ?? modelId} ${quantLabel} ${kind} board`}
                description="Try clearing a filter."
                action={submit}
              />
            ) : (
              <EmptyBoard
                variant="chart"
                lead={`No eligible results yet on the ${model?.name ?? modelId} ${quantLabel} ${kind} board.`}
                submitTo={`/submit?model=${modelId}&quant=${quant}`}
              />
            )
          )
        ) : null}
      </Section>
    </div>
  )
}
