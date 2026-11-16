import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip, type ChartConfig } from '@/components/ui/chart'
import { RuntimeDot } from '@/components/RuntimeBadge'
import type { Runtime } from '@/lib/api/types'
import type { StreamSeries } from '@/lib/streams'
import { fmtTps, pluralize } from '@/lib/format'

const SCOPE_TITLE = { total: 'Total decode tok/s across requests', per_request: 'Decode tok/s each request sees' } as const

/**
 * Decode rate against concurrent requests, one line per measured setup, colored by runtime. Totals and per-request
 * rates are different quantities, so each scope gets its own chart. Points link to the result that holds them.
 */
export function StreamsChart({ series, runtimes, className }: { series: StreamSeries[]; runtimes: Runtime[]; className?: string }) {
  const navigate = useNavigate()
  const byId = useMemo(() => Object.fromEntries(runtimes.map((r) => [r.id, r])), [runtimes])
  const scopes = (['total', 'per_request'] as const).filter((scope) => series.some((s) => s.scope === scope))
  if (!scopes.length) return null
  return (
    <div className={className}>
      {scopes.map((scope) => {
        const lines = series.filter((s) => s.scope === scope)
        const xs = [...new Set(lines.flatMap((s) => s.points.map((p) => p.concurrency)))].sort((a, b) => a - b)
        const data = xs.map((x) => Object.fromEntries([['concurrency', x], ...lines.map((s) => [s.key, s.points.find((p) => p.concurrency === x)?.decodeTps ?? null])]))
        const config: ChartConfig = Object.fromEntries(lines.map((s) => [s.key, { label: s.label, color: byId[s.runtimeId]?.color ?? 'var(--muted-foreground)' }]))
        const summary = lines.map((s) => `${s.label}: ${s.points.map((p) => `${fmtTps(p.decodeTps)} at ${p.concurrency}`).join(', ')}`).join('; ')
        return (
          <div key={scope} className="py-4" role="img" aria-label={`${SCOPE_TITLE[scope]} by concurrent requests. ${summary}`}>
            <div className="mb-2 text-xs font-medium text-muted-foreground">{SCOPE_TITLE[scope]}</div>
            <ChartContainer config={config} className="w-full" style={{ height: 260 }}>
              <LineChart data={data} margin={{ left: 0, right: 16, top: 8, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis
                  dataKey="concurrency" type="number" domain={['dataMin', 'dataMax']} ticks={xs} tickLine={false} axisLine={false}
                  tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} label={{ value: 'concurrent requests', position: 'insideBottomRight', offset: -2, fill: 'var(--muted-foreground)', fontSize: 11 }}
                />
                <YAxis type="number" tickLine={false} axisLine={false} width={48} tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }} tickFormatter={(v: number) => fmtTps(v)} />
                <ChartTooltip
                  cursor={{ stroke: 'var(--border)' }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null
                    return (
                      <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-md">
                        <div className="font-medium text-foreground">{pluralize(Number(label), 'concurrent request')}</div>
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
                    dot={({ cx, cy, payload, value }: { cx?: number; cy?: number; payload?: { concurrency?: number }; value?: number | null }) => {
                      const point = s.points.find((p) => p.concurrency === payload?.concurrency)
                      if (cx == null || cy == null || value == null || !point) return <g key={`${s.key}-${payload?.concurrency}`} />
                      return (
                        <circle
                          key={`${s.key}-${point.concurrency}`} cx={cx} cy={cy} r={4} fill={config[s.key].color} className="cursor-pointer"
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
