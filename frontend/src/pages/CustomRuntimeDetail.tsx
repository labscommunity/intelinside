import { ExternalLink, GitFork, Pencil } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PageHeader } from '@/components/PageHeader'
import { IconAction } from '@/components/IconAction'
import { RuntimeBadge } from '@/components/RuntimeBadge'
import { UserLink } from '@/components/UserLink'
import { TpsBarChart } from '@/components/TpsBarChart'
import { ResultsTable } from '@/components/ResultsTable'
import { EmptyBoard } from '@/components/empty'
import { ErrorState } from '@/components/ErrorState'
import { Block, Cell, CellGrid, Section, inset } from '@/components/frame'
import { useAsync } from '@/hooks/useAsync'
import { useCatalog } from '@/hooks/useCatalog'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useSession } from '@/hooks/useSession'
import { api } from '@/lib/api'
import { fmtDate, fmtInt, fmtTps } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * A custom runtime's own page. This is the point of the whole feature: kernel work stops being a string on somebody's
 * result and becomes a thing with a name, an author, and a record of what it did.
 */
export default function CustomRuntimeDetail() {
  const { customId } = useParams()
  const { user, requestSignIn } = useSession()
  const cat = useCatalog()
  const build = useAsync(() => (customId ? api.customRuntime(customId) : Promise.reject(new Error('no custom runtime'))), [customId])
  usePageTitle(build.data?.name ?? 'Custom runtime')

  if (build.error) return <ErrorState error={build.error} />
  const b = build.data
  const runtime = cat.data?.runtimes.find((r) => r.id === b?.runtimeId)

  const submit = b
    ? user
      ? (
          <Button render={<Link to={`/submit?runtime=${b.runtimeId}&custom=${b.id}`} />} nativeButton={false}>
            Submit a result on this one
          </Button>
        )
      : <Button onClick={() => requestSignIn('/submit')}>Submit a result on this one</Button>
    : undefined

  return (
    <div>
      <PageHeader
        eyebrow={
          <span className="inline-flex items-center gap-2">
            <Link to="/runtimes" className="hover:text-foreground">Runtimes</Link>
            <span className="text-muted-foreground/50">/</span>
            {runtime ? <Link to={`/runtimes/${runtime.id}`} className="hover:text-foreground">{runtime.name}</Link> : null}
          </span>
        }
        title={
          <span className="inline-flex flex-wrap items-center gap-3">
            {b ? b.name : <Skeleton className="h-9 w-72" />}
            {b ? (
              <span className="inline-flex items-center gap-1.5 rounded-4xl border border-warning/40 px-2 py-0.5 text-xs font-medium text-warning">
                <GitFork className="size-3" /> Custom
              </span>
            ) : null}
          </span>
        }
        description={b?.summary}
        actions={
          <>
            {b && user?.id === b.ownerId ? (
              <IconAction label="Edit" to={`/runtimes/${b.runtimeId}/custom/${b.id}/edit`}>
                <Pencil />
              </IconAction>
            ) : null}
            {b?.sourcePrUrl ? <Button variant="outline" render={<a href={b.sourcePrUrl} target="_blank" rel="noreferrer" />} nativeButton={false}>Submission PR <ExternalLink /></Button> : null}
            {submit}
          </>
        }
      >
        {b ? (
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
            <UserLink user={b.owner} />
            <span className="text-muted-foreground/50">·</span>
            <span className="text-muted-foreground">based on</span>
            <RuntimeBadge runtime={runtime} />
            <span className="text-muted-foreground/50">·</span>
            <a
              href={b.repoUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
            >
              {b.repoUrl.replace(/^https?:\/\/(www\.)?/, '')}
              <ExternalLink className="size-3 shrink-0" />
            </a>
          </div>
        ) : null}
      </PageHeader>

      <Section>
        <CellGrid cols={4}>
          <Stat label="best tok/s" value={b ? fmtTps(b.bestTps) : undefined} />
          <Stat label="results" value={b ? fmtInt(b.resultsCount ?? 0) : undefined} />
          <Stat label="rigs it has run on" value={b ? fmtInt(b.rigsCount ?? 0) : undefined} />
          <Stat label="people posting on it" value={b ? fmtInt(new Set(b.results.map((r) => r.submitterId)).size) : undefined} />
        </CellGrid>
      </Section>

      {b && b.results.length ? (
        <>
          <Section label="Tok/s by model">
            <Block>
              <TpsBarChart bars={b.chart} runtimes={cat.data?.runtimes ?? []} />
            </Block>
          </Section>
          <Section label="Results on this custom runtime">
            <ResultsTable results={b.results} runtimes={cat.data?.runtimes ?? []} models={cat.data?.models ?? []} quants={cat.data?.quants ?? []} />
          </Section>
        </>
      ) : b ? (
        <Section label="Results on this custom runtime">
          <EmptyBoard
            variant="chart"
            lead="Nothing posted on it yet."
            ask="Run something on it and submit the number."
            body="Registering a custom runtime and posting a result are two steps. This fills in once the second one is done."
            submitTo={b ? `/submit?runtime=${b.runtimeId}&custom=${b.id}` : '/submit'}
          />
        </Section>
      ) : (
        <Section>
          <Block><Skeleton className="h-40" /></Block>
        </Section>
      )}

      {b?.notes ? (
        <Section label="Notes">
          <div className={cn('max-w-2xl py-6 text-sm leading-relaxed text-muted-foreground text-pretty', inset)}>{b.notes}</div>
        </Section>
      ) : null}

      {b ? (
        <Section>
          <div className={cn('py-5 text-xs text-muted-foreground', inset)}>Registered {fmtDate(b.createdAt)}</div>
        </Section>
      ) : null}
    </div>
  )
}

function Stat({ label, value }: { label: string; value?: string }) {
  return (
    <Cell>
      <div className="font-mono text-2xl font-medium tnum">{value ?? <Skeleton className="h-7 w-16" />}</div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
    </Cell>
  )
}
