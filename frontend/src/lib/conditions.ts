import type { DecodeMethod, DecodeScope, Result, Speculative } from '@/lib/api/types'

/**
 * The conditions behind a result (issue #130): what was sent, how it was run, and how it was timed. All optional,
 * so older results stay valid and show as "conditions not recorded". One definition here feeds the PR parser, the
 * submit form, and the result page, so the three cannot disagree.
 */
export type Conditions = Pick<Result,
  'inputTokens' | 'outputTokens' | 'concurrency' | 'decodeScope' | 'decodeMethod' | 'repeats' | 'promptCache' | 'thinking' | 'speculative'>

export const CONDITION_KEYS = ['inputTokens', 'outputTokens', 'concurrency', 'decodeScope', 'decodeMethod', 'repeats', 'promptCache', 'thinking', 'speculative'] as const
export const INTEGER_CONDITIONS = ['inputTokens', 'outputTokens', 'concurrency', 'repeats'] as const
export const BOOLEAN_CONDITIONS = ['promptCache', 'thinking'] as const

export const DECODE_SCOPES: Record<DecodeScope, string> = { per_request: 'Per request', total: 'Total throughput' }
export const DECODE_METHODS: Record<DecodeMethod, string> = {
  streamed: 'Streamed, after first token',
  engine: 'Engine timing',
  llama_bench: 'llama-bench',
  wall: 'Wall clock, incl. prefill',
}
export const SPECULATIVE: Record<Speculative, string> = { none: 'None', lossless: 'Lossless', lossy: 'Lossy' }
export const ENUM_CONDITIONS = { decodeScope: DECODE_SCOPES, decodeMethod: DECODE_METHODS, speculative: SPECULATIVE } as const

/** Largest whole number a condition accepts: the database column is a 32-bit integer. */
export const CONDITION_INT_MAX = 2147483647

export const hasConditions = (r: Partial<Conditions>) => CONDITION_KEYS.some((key) => r[key] != null)

/**
 * Checks one result's conditions, as parsed from a file, a form, or an API body. Keyed by field so the form can show
 * each message beside its input; the PR parser lists the values. An empty object means valid.
 */
export function conditionErrors(c: Partial<Record<keyof Conditions, unknown>>): Partial<Record<keyof Conditions, string>> {
  const errors: Partial<Record<keyof Conditions, string>> = {}
  for (const key of INTEGER_CONDITIONS) {
    const v = c[key]
    if (v != null && !(typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= CONDITION_INT_MAX)) errors[key] = `"${key}" must be a whole number of 1 or more.`
  }
  for (const key of BOOLEAN_CONDITIONS) {
    const v = c[key]
    if (v != null && typeof v !== 'boolean') errors[key] = `"${key}" must be true or false.`
  }
  for (const [key, allowed] of Object.entries(ENUM_CONDITIONS) as [keyof typeof ENUM_CONDITIONS, Record<string, string>][]) {
    const v = c[key]
    if (v != null && !(typeof v === 'string' && v in allowed)) errors[key] = `"${key}" must be one of ${Object.keys(allowed).map((a) => `"${a}"`).join(', ')}.`
  }
  if (c.decodeScope != null && !errors.decodeScope && !(typeof c.concurrency === 'number' && c.concurrency > 1)) errors.decodeScope = '"decodeScope" only applies when "concurrency" is above 1.'
  return errors
}
export const conditionProblems = (c: Partial<Record<keyof Conditions, unknown>>) => Object.values(conditionErrors(c)) as string[]

const tokens = (n: number) => (n >= 1000 && n % 1000 === 0 ? `${n / 1000}k` : n.toLocaleString('en-US'))

/** What was run: prompt, output, and simultaneous requests. Absent conditions are left out. */
export function workloadChips(r: Partial<Conditions>): string[] {
  const chips: string[] = []
  if (r.inputTokens != null) chips.push(`${tokens(r.inputTokens)} in`)
  if (r.outputTokens != null) chips.push(`${tokens(r.outputTokens)} out`)
  if (r.concurrency != null) chips.push(`${r.concurrency} req${r.concurrency > 1 && r.decodeScope ? (r.decodeScope === 'total' ? ', total' : ', per request') : ''}`)
  return chips
}

/** How it was run and timed. Absent conditions are left out. */
export function methodChips(r: Partial<Conditions>): string[] {
  const chips: string[] = []
  if (r.speculative != null) chips.push(r.speculative === 'none' ? 'no speculation' : `speculation: ${r.speculative}`)
  if (r.decodeMethod != null) chips.push(DECODE_METHODS[r.decodeMethod].toLowerCase())
  if (r.thinking != null) chips.push(r.thinking ? 'thinking on' : 'thinking off')
  if (r.promptCache != null) chips.push(r.promptCache ? 'prompt cache on' : 'prompt cache off')
  if (r.repeats != null) chips.push(`×${r.repeats}`)
  return chips
}

export const conditionChips = (r: Partial<Conditions>) => [...workloadChips(r), ...methodChips(r)]

/**
 * The few conditions that move the number most, for one line in a board row: prompt, output, requests, plus
 * speculation when on and wall-clock timing (which reads lower). The result page shows the rest.
 */
export function compactChips(r: Partial<Conditions>): string[] {
  const chips = workloadChips(r)
  if (r.speculative === 'lossless' || r.speculative === 'lossy') chips.push(`speculation: ${r.speculative}`)
  if (r.decodeMethod === 'wall') chips.push('wall clock')
  return chips
}

/**
 * The model file that ran and how far the repeats spread (issue #130, step 4). Optional like the conditions, but no
 * setup checks them: they let a reader tell two files of the same quant apart, and a steady number from a noisy one.
 */
export type RunDetails = Pick<Result, 'modelRepo' | 'modelFile' | 'modelSha256' | 'decodeTpsMin' | 'decodeTpsMax'>
export const DETAIL_KEYS = ['modelRepo', 'modelFile', 'modelSha256', 'decodeTpsMin', 'decodeTpsMax'] as const
export const MODEL_REPO_MAX = 200
export const MODEL_FILE_MAX = 255
const SHA256 = /^[0-9a-f]{64}$/

/** Lowercases the hash, the one detail with two spellings. Everything else passes through. */
export const normalizeSha256 = (value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase() : value)

/** Checks one result's details against its decode rate, keyed by field like `conditionErrors`. */
export function detailErrors(d: Partial<Record<keyof RunDetails, unknown>>, decodeTps?: unknown): Partial<Record<keyof RunDetails, string>> {
  const errors: Partial<Record<keyof RunDetails, string>> = {}
  for (const [key, max] of [['modelRepo', MODEL_REPO_MAX], ['modelFile', MODEL_FILE_MAX]] as const) {
    const v = d[key]
    if (v != null && !(typeof v === 'string' && v.trim() && v === v.trim() && v.length <= max)) errors[key] = `"${key}" must be text of ${max} characters or fewer.`
  }
  if (d.modelSha256 != null && !(typeof d.modelSha256 === 'string' && SHA256.test(d.modelSha256))) errors.modelSha256 = '"modelSha256" must be 64 lowercase hex characters.'
  const rate = typeof decodeTps === 'number' && decodeTps > 0 ? decodeTps : undefined
  for (const key of ['decodeTpsMin', 'decodeTpsMax'] as const) {
    const v = d[key]
    if (v == null) continue
    if (!(typeof v === 'number' && Number.isFinite(v) && v > 0)) errors[key] = `"${key}" must be a number above zero.`
    else if (rate != null && (key === 'decodeTpsMin' ? v > rate : v < rate)) errors[key] = `"${key}" must be ${key === 'decodeTpsMin' ? 'at most' : 'at least'} "decodeTps".`
  }
  return errors
}
export const detailProblems = (d: Partial<Record<keyof RunDetails, unknown>>, decodeTps?: unknown) => Object.values(detailErrors(d, decodeTps)) as string[]

/** The details worth a line on the result page: spread, then the file. */
export function spreadLabel(r: Partial<RunDetails>): string | undefined {
  if (r.decodeTpsMin == null && r.decodeTpsMax == null) return undefined
  const fmt = (n?: number) => (n == null ? '?' : n.toFixed(n >= 100 ? 0 : 1))
  return `${fmt(r.decodeTpsMin)}–${fmt(r.decodeTpsMax)}`
}
