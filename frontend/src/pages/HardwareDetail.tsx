import { Link, useParams } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/PageHeader'
import { HardwareTypeIcon } from '@/components/HardwareTypeIcon'
import { VendorMark } from '@/components/VendorMark'
import { TpsBarChart } from '@/components/TpsBarChart'
import { ResultsTable } from '@/components/ResultsTable'
import { RigCard, keySpec } from '@/components/cards'
import { EmptyBoard } from '@/components/empty'
import { EmptyState } from '@/components/EmptyState'
import { ErrorState } from '@/components/ErrorState'
import { Block, Cell, CellGrid, Framed, Section, inset } from '@/components/frame'
import { useAsync } from '@/hooks/useAsync'
import { useCatalog } from '@/hooks/useCatalog'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useSession } from '@/hooks/useSession'
import { api } from '@/lib/api'
import type { HardwareDetail as HardwareDetailData, HardwareItem } from '@/lib/api/types'
import { fmtDate, fmtTps, pluralize } from '@/lib/format'
import { UNIT_LABEL, hostsOf, integratedParts } from '@/lib/hardware'
import { cn } from '@/lib/utils'
import { HARDWARE_TYPE_LABEL } from '@/catalog'

const SPEC_LABEL: Record<string, string> = {
  cores: 'Cores', threads: 'Threads', boostGhz: 'Boost clock', tdpW: 'TDP', platform: 'Platform', vramGb: 'Memory', memoryType: 'Memory type',
  xeCores: 'Xe cores', euCount: 'Execution units', architecture: 'Architecture', tops: 'NPU TOPS', type: 'Type', speedMts: 'Speed', capacityGb: 'Capacity', formFactor: 'Form factor',
}
const SPEC_UNIT: Record<string, string> = { boostGhz: ' GHz', tdpW: ' W', vramGb: ' GB', speedMts: ' MT/s', capacityGb: ' GB' }

/** One compute unit on a chip: the CPU cores (this page) or a part on its package, with its best decode tok/s. */
function UnitCell({ hardware, unit, current = false, detail }: { hardware: HardwareItem; unit: string; current?: boolean; detail?: HardwareDetailData }) {
  const best = detail?.results[0]?.decodeTps
  const body = (
    <>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <HardwareTypeIcon type={hardware.type} className="size-3.5" /> {unit}
        {current ? <span className="ml-auto">This page</span> : null}
      </div>
      <div className="mt-2 font-medium">{hardware.name}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{keySpec(hardware)}</div>
      <div className="mt-4">
        <div className="font-mono text-2xl tnum">
          {best != null ? fmtTps(best) : '—'} <span className="text-sm font-normal text-muted-foreground">tok/s best</span>
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">{detail ? pluralize(detail.resultsCount ?? 0, 'result') : '…'}</div>
      </div>
    </>
  )
  const classes = 'flex min-w-0 flex-col bg-background p-6 md:p-7'
  return current ? (
    <div className={classes}>{body}</div>
  ) : (
    <Link to={`/hardware/${hardware.id}`} className={cn(classes, 'transition-colors hover:bg-card')}>
      {body}
    </Link>
  )
}

export default function HardwareDetail() {
  const { hardwareId = '' } = useParams()
  const item = useAsync(() => api.hardwareItem(hardwareId), [hardwareId])
  const cat = useCatalog()
  const { user, requestSignIn } = useSession()
  usePageTitle(item.data?.name)
  // A CPU with parts on its package shows the units side by side, so the other parts' details load once the CPU is known.
  const integratedIds = (item.data?.integrated ?? []).join(',')
  const units = useAsync(
    () => (integratedIds ? Promise.all(integratedIds.split(',').map((id) => api.hardwareItem(id))) : Promise.resolve<HardwareDetailData[]>([])),
    [integratedIds],
  )
  if (item.error)
    return (
      <Block>
        <ErrorState error={item.error} />
      </Block>
    )
  if (!item.data || !cat.data)
    return (
      <Block>
        <Skeleton className="h-96" />
      </Block>
    )
  const h = item.data
  const integrated = integratedParts(h)
  const hosts = hostsOf(h)
  const resultsLabel = integrated.length ? 'Results on the CPU cores' : 'Results on this part'
  const newRig = user ? (
    <Button variant="outline" render={<Link to="/rigs/new" />} nativeButton={false}>New rig</Button>
  ) : (
    <Button variant="outline" onClick={() => requestSignIn('/rigs/new')}>New rig</Button>
  )
  return (
    <div>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-1.5">
            <HardwareTypeIcon type={h.type} className="size-3.5" /> {HARDWARE_TYPE_LABEL[h.type]} · <VendorMark vendor={h.vendor} withName />
            {h.series ? ` · ${h.series}` : ''}
          </span>
        }
        title={h.name}
        description={`${pluralize(h.resultsCount ?? 0, 'result')} · ${pluralize(h.rigsCount ?? 0, 'rig')}${h.releaseDate ? ` · released ${fmtDate(h.releaseDate)}` : ''}`}
        actions={<Badge variant="outline">{h.source === 'seeded' ? 'Seeded' : 'Community added'}</Badge>}
      />
      <Section label="Specifications">
        <CellGrid cols={4}>
          {Object.entries(h.specs).map(([k, v]) => (
            <Cell key={k} className="py-5 md:py-5">
              <div className="text-xs text-muted-foreground">{SPEC_LABEL[k] ?? k}</div>
              <div className="mt-1 font-mono text-lg tnum">
                {v}
                {SPEC_UNIT[k] ?? ''}
              </div>
            </Cell>
          ))}
        </CellGrid>
      </Section>
      {integrated.length ? (
        <Section label="On the package" action={<span className="text-xs text-muted-foreground">Each unit ranks as its own part</span>}>
          <CellGrid cols={integrated.length >= 2 ? 3 : 2}>
            <UnitCell hardware={h} unit={UNIT_LABEL.cpu} current detail={h} />
            {integrated.map((part) => (
              <UnitCell key={part.id} hardware={part} unit={UNIT_LABEL[part.type]} detail={units.data?.find((d) => d.id === part.id)} />
            ))}
          </CellGrid>
        </Section>
      ) : null}
      {hosts.length ? (
        <Section label="Found in">
          <div className={cn('flex flex-wrap items-center gap-2 py-5', inset)}>
            {hosts.map((cpu) => (
              <Link key={cpu.id} to={`/hardware/${cpu.id}`} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition-colors hover:border-foreground/30">
                <HardwareTypeIcon type="cpu" className="size-3.5 text-muted-foreground" /> {cpu.name}
              </Link>
            ))}
            <span className="ml-1 text-xs text-muted-foreground">Comes with the CPU when a rig is registered. Results here are runs on the {UNIT_LABEL[h.type]} alone.</span>
          </div>
        </Section>
      ) : null}
      {h.results.length ? (
        <Section label={integrated.length ? 'Best decode tok/s per model, quant, and runtime, on the CPU cores' : 'Best decode tok/s per model, quant, and runtime'}>
          <Framed>
            <TpsBarChart bars={h.chart} runtimes={cat.data.runtimes} />
          </Framed>
        </Section>
      ) : null}
      <Section label={resultsLabel}>
        {h.results.length ? (
          <ResultsTable results={h.results} runtimes={cat.data.runtimes} models={cat.data.models} quants={cat.data.quants} />
        ) : (
          <EmptyBoard
            variant="chart"
            lead={integrated.length ? 'No results on the CPU cores yet.' : `No results name the ${h.name} yet.`}
            ask="Post one that names this part."
            body={integrated.length
              ? 'Runs on the iGPU or NPU are listed on their own pages, and whole-rig results live on the rig pages. A result here is the cores alone.'
              : 'A component result names the part and how many of it you used. Whole-rig results live on the rig pages.'}
          />
        )}
      </Section>
      <Section label="Rigs with this part">
        {h.rigs.length ? (
          <CellGrid cols={3}>
            {h.rigs.map((r) => (
              <RigCard key={r.id} rig={r} />
            ))}
          </CellGrid>
        ) : (
          <EmptyState
            title="No rigs list this part yet"
            description="Register a machine with this part in it and the rig shows up here."
            action={newRig}
          />
        )}
      </Section>
    </div>
  )
}
