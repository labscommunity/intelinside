import type { Model, Quant, Result, ResultRank, Rig, RigSummary, Runtime } from '@/lib/api/types'
import { BRAND_NAME } from '@/lib/brand'
import { fmtTps } from '@/lib/format'

/*
  Everything the share modal needs about the thing being shared. Pages build one of these from data they
  already hold; the modal derives the link, the card image, the post text, and the download filename from it.
*/

export type ShareKind = 'result' | 'rig'

export type ShareTarget = {
  kind: ShareKind
  id: string
  /** Busts the card image cache after an edit. */
  updatedAt?: string
  /** Dialog title, for example "Share this result". */
  title: string
  /** The text that goes with the link on X, Threads, and as the Reddit title. */
  text: string
}

export function sharePath(target: Pick<ShareTarget, 'kind' | 'id'>): string {
  return `/${target.kind}s/${target.id}`
}

export function shareUrl(target: Pick<ShareTarget, 'kind' | 'id'>, origin = window.location.origin): string {
  return `${origin}${sharePath(target)}`
}

/** The card the link unfurls with; the same PNG the modal previews, downloads, and copies. */
export function cardImageUrl(target: Pick<ShareTarget, 'kind' | 'id' | 'updatedAt'>, origin = window.location.origin): string {
  const version = target.updatedAt ? `&v=${encodeURIComponent(target.updatedAt)}` : ''
  return `${origin}/api/og/${target.kind}?id=${encodeURIComponent(target.id)}${version}`
}

export function cardFilename(target: Pick<ShareTarget, 'kind' | 'id'>): string {
  return `${BRAND_NAME.toLowerCase()}-${target.kind}-${target.id}.png`
}

function hardwarePhrase(result: Result): string {
  if (result.component) {
    const quantity = result.componentQuantity ?? 1
    return `${quantity > 1 ? `${quantity}× ` : 'one '}${result.component.name}`
  }
  return result.rig?.name ?? 'my rig'
}

export function resultShareTarget(
  result: Result,
  catalog: { models: Model[]; quants: Quant[]; runtimes: Runtime[] },
  rank?: ResultRank,
): ShareTarget {
  const model = catalog.models.find((m) => m.id === result.modelId)?.name ?? result.modelId
  const quant = catalog.quants.find((q) => q.id === result.quant)?.label ?? result.quant
  const runtime = catalog.runtimes.find((r) => r.id === result.runtimeId)?.name ?? result.runtimeId
  const rankLine = rank?.position ? ` #${rank.position} on the ${BRAND_NAME} board.` : ''
  return {
    kind: 'result',
    id: result.id,
    updatedAt: result.updatedAt,
    title: 'Share this result',
    text: `${fmtTps(result.decodeTps)} tok/s on ${model} ${quant} with ${hardwarePhrase(result)} on ${runtime}.${rankLine}`,
  }
}

export function rigShareTarget(
  rig: Rig | RigSummary,
  best?: { tps: number; model?: string; quant?: string },
): ShareTarget {
  const bestLine = best
    ? ` Best ${fmtTps(best.tps)} tok/s${best.model ? ` on ${best.model}${best.quant ? ` ${best.quant}` : ''}` : ''}.`
    : ''
  return {
    kind: 'rig',
    id: rig.id,
    updatedAt: 'updatedAt' in rig ? rig.updatedAt : undefined,
    title: 'Share this rig',
    text: `${rig.name} on ${BRAND_NAME}: ${rig.summary}.${bestLine}`,
  }
}

export type Platform = 'x' | 'reddit' | 'discord' | 'linkedin' | 'threads' | 'facebook'

export const PLATFORMS: { id: Platform; label: string }[] = [
  { id: 'x', label: 'X' },
  { id: 'reddit', label: 'Reddit' },
  { id: 'discord', label: 'Discord' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'threads', label: 'Threads' },
  { id: 'facebook', label: 'Facebook' },
]

/**
 * The share intent for a platform, or null for Discord, which has none: the modal copies the link and opens
 * Discord instead. X, Threads, and Reddit take the text; LinkedIn and Facebook take the link only.
 */
export function platformIntent(platform: Platform, url: string, text: string): string | null {
  const u = encodeURIComponent(url)
  const t = encodeURIComponent(text)
  switch (platform) {
    case 'x':
      return `https://x.com/intent/post?text=${t}&url=${u}`
    case 'reddit':
      return `https://www.reddit.com/submit?url=${u}&title=${t}`
    case 'linkedin':
      return `https://www.linkedin.com/sharing/share-offsite/?url=${u}`
    case 'threads':
      return `https://www.threads.net/intent/post?text=${encodeURIComponent(`${text} ${url}`)}`
    case 'facebook':
      return `https://www.facebook.com/sharer/sharer.php?u=${u}`
    case 'discord':
      return null
  }
}

export const DISCORD_APP_URL = 'https://discord.com/channels/@me'
