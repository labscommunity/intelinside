export function fmtTps(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n >= 100) return n.toFixed(0)
  if (n >= 10) return n.toFixed(1)
  return n.toFixed(2)
}

export function fmtInt(n: number | undefined | null): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('en-US').format(n)
}

export function fmtMs(n: number | undefined | null): string {
  if (n == null) return '—'
  return n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n)} ms`
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * "Sep 2, 2026". Date-only values such as a run date are calendar days, not instants: they are formatted in UTC so
 * the day never shifts with the viewer's zone. Full timestamps keep the viewer's zone.
 */
export function fmtDate(iso: string): string {
  const dateOnly = DATE_ONLY.test(iso)
  return new Date(dateOnly ? `${iso}T00:00:00Z` : iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(dateOnly ? { timeZone: 'UTC' } : {}),
  })
}

export function pluralize(n: number, one: string, many = `${one}s`): string {
  return `${fmtInt(n)} ${n === 1 ? one : many}`
}
