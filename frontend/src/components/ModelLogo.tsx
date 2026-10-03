import type { Model } from '@/lib/api/types'
import { cn } from '@/lib/utils'

const TILE = { sm: 'size-6 rounded-md', md: 'size-9 rounded-lg', lg: 'size-12 rounded-xl' } as const
const MARK = { sm: 'size-3.5', md: 'size-5', lg: 'size-7' } as const
const TEXT = { sm: 'text-xs', md: 'text-base', lg: 'text-xl' } as const

/**
 * SVG marks sit inset on a neutral tile; image avatars fill the rounded tile.
 * Models without a logo use a monogram in the family's color.
 */
export function ModelLogo({ model, size = 'md', className }: { model: Pick<Model, 'name' | 'family' | 'logoUrl' | 'brandColor'>; size?: keyof typeof TILE; className?: string }) {
  const isSvg = /\.svg(?:[?#]|$)/i.test(model.logoUrl ?? '')

  return (
    <span aria-hidden className={cn('inline-flex shrink-0 items-center justify-center overflow-hidden bg-secondary', TILE[size], className)}>
      {model.logoUrl ? (
        <img src={model.logoUrl} alt="" className={isSvg ? cn('object-contain', MARK[size]) : 'size-full object-cover'} />
      ) : (
        <span className={cn('font-heading font-semibold', TEXT[size])} style={{ color: model.brandColor ?? 'var(--muted-foreground)' }}>
          {model.family.charAt(0).toUpperCase()}
        </span>
      )}
    </span>
  )
}
