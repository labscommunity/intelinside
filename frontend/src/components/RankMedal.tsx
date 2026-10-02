import { cn } from '@/lib/utils'

// Gold, silver, and bronze art lives in public/medals. Drawn on a 48px frame, so md shows it at 1:1.
const MEDALS: Record<number, { name: string; src: string }> = {
  1: { name: 'First place', src: '/medals/1.svg' },
  2: { name: 'Second place', src: '/medals/2.svg' },
  3: { name: 'Third place', src: '/medals/3.svg' },
}

const SIZE = { sm: 'size-7 text-xs', md: 'size-9 text-sm', lg: 'size-11 text-base' } as const
const MEDAL_SIZE = { sm: 'size-9', md: 'size-12', lg: 'size-14' } as const

/** Gold, silver, and bronze for the top three; a plain tile for everything else. */
export function RankMedal({ rank, size = 'md', className }: { rank: number; size?: keyof typeof SIZE; className?: string }) {
  const m = MEDALS[rank]
  if (!m) {
    return <span className={cn('inline-flex items-center justify-center rounded-lg bg-secondary font-mono font-semibold tnum', SIZE[size], className)}>{rank}</span>
  }
  return <img src={m.src} alt={m.name} width={48} height={48} draggable={false} className={cn('shrink-0 select-none', MEDAL_SIZE[size], className)} />
}
