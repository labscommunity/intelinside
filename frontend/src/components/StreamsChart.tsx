import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart'
import { RuntimeDot } from '@/components/RuntimeBadge'
import type { Runtime } from '@/lib/api/types'
import type { StreamSeries } from '@/lib/streams'
import { fmtTps, pluralize } from '@/lib/format'

const SCOPE_TITLE = { total: 'Total decode tok/s across requests', per_request: 'Decode tok/s each request sees' } as const
const tokens = (n: number) => (n >= 1024 && n % 1024 === 0 ? `${n / 1024}k` : n >= 1000 && n % 1000 === 0 ? `${n / 1000}k` : n.toLocaleString('en-US'))

/** Per axis: the chart's title, its x label, how a tick and a tooltip read, and whether x is logarithmic. */
const AXIS = {
  concurrency: {
    title: (scope: StreamSeries['scope']) => SCOPE_TITLE[scope], label: 'concurrent requests', log: false,
    tick: (x: number) => String(x), tooltip: (x: number) => pluralize(x, 'concurrent request'), aria: 'by concurrent requests', at: (x: number) => `at ${x}`,
  },
  // Prompt grids double (512, 4k, 16k, 32k), so a log scale spaces them evenly.
  input: {
    title: () => 'Decode tok/s for one request, by prompt length', label: 'prompt tokens', log: true,
    tick: tokens, tooltip: (x: number) => `${tokens(x)} prompt tokens`, aria: 'by prompt length', at: (x: number) => `after ${tokens(x)}`,
  },
} as const

/**
 * Decode rate against concurrent requests or prompt length, one line per measured setup, colored by runtime. Totals
 * and per-request rates are different quantities, so each scope gets its own chart. Points link to their result.
 */
export function StreamsChart({ series, runtimes, className }: { series: StreamSeries[]; runtimes: Runtime[]; className?: string }) {
  const navigate = useNavigate()
  const byId = useMemo(() => Object.fromEntries(runtimes.map((r) => [r.id, r])), [runtimes])
  const scopes = (['total', 'per_request'] as const).filter((scope) => series.some((s) => s.scope === scope))
  if (!scopes.length) return null
  const axis = AXIS[series[0].axis]
  return (
    <div className={className}>
      {scopes.map((scope) => {
        const lines = series.filter((s) => s.scope === scope)
        const xs = [...new Set(lines.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b)
        const data = xs.map((x) => Object.fromEntries([['x', x], ...lines.map((s) => [s.key, s.points.find((p) => p.x === x)?.decodeTps ?? null])]))
        const config: ChartConfig = Object.fromEntries(lines.map((s) => [s.key, { label: s.label, color: byId[s.runtimeId]?.color ?? 'var(--muted-foreground)' }]))
        const summary = lines.map((s) => `${s.label}: ${s.points.map((p) => `${fmtTps(p.decodeTps)} ${axis.at(p.x)}`).join(', ')}`).join('; ')
        return (
          <div key={scope} className="py-4" role="img" aria-label={`${axis.title(scope)} ${axis.aria}. ${summary}`}>
            <div className="mb-2 text-xs font-medium text-muted-foreground">{axis.title(scope)}</div>
            <ChartContainer config={config} className="w-full" style={{ height: 260 }}>
              <LineChart data={data} margin={{ left: 0, right: 16, top: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="x" type="number" scale={axis.log ? 'log' : 'auto'} domain={['dataMin', 'dataMax']} ticks={xs} tickLine={false} axisLine={false}
                  tickFormatter={(v: number) => axis.tick(v)}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} label={{ value: axis.label, position: 'insideBottomRight', offset: -2, fill: 'var(--muted-foreground)', fontSize: 11 }}
                />
                <YAxis type="number" tickLine={false} axisLine={false} width={48} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} tickFormatter={(v: number) => fmtTps(v)} />
                <ChartTooltip
                  cursor={{ stroke: 'var(--border)' }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    return (
                      <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                        <div className="font-medium text-foreground">{axis.tooltip(Number(label))}</div>
                        {payload.filter((p) => p.value != null).map((p) => {
                          const s = lines.find((line) => line.key === p.dataKey)
                          return s ? (
                            <div key={s.key} className="mt-1 flex items-center gap-1.5 text-muted-foreground">
                              <RuntimeDot runtime={byId[s.runtimeId]} /> {s.label}
                              <span className="ml-2 font-mono text-foreground">{fmtTps(Number(p.value))} tok/s</span>
                            </div>
                          ) : null
                        })}
                      </div>
                    )
                  }}
                />
                {lines.map((s) => (
                  <Line
                    key={s.key} dataKey={s.key} type="monotone" connectNulls stroke={config[s.key].color} strokeWidth={2}
                    activeDot={{ r: 6 }} isAnimationActive={false}
                    // Each point links to the result that holds it.
                    dot={({ cx, cy, payload, value }: { cx?: number; cy?: number; payload?: { x?: number }; value?: number | null }) => {
                      const point = s.points.find((p) => p.x === payload?.x)
                      if (cx == null || cy == null || value == null || !point) return <g key={`${s.key}-${payload?.x}`} />
                      return (
                        <circle
                          key={`${s.key}-${point.x}`} cx={cx} cy={cy} r={4} fill={config[s.key].color} className="cursor-pointer"
                          onClick={() => navigate(`/results/${point.resultId}`)}
                        />
                      )
                    }}
                  />
                ))}
              </LineChart>
            </ChartContainer>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {lines.map((s) => (
                <span key={s.key} className="inline-flex items-center gap-1.5">
                  <RuntimeDot runtime={byId[s.runtimeId]} /> {s.label} · {byId[s.runtimeId]?.name ?? s.runtimeId}
                </span>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
