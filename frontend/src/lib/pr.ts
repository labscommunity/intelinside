import { REVISION_MAX, RUNTIME_FLAGS_MAX, type Result, type ResultInput } from '@/lib/api/types'
import { REPO } from '@/lib/brand'
import { HARDWARE_BY_ID, MODEL_BY_ID, QUANT_BY_ID, RUNTIME_BY_ID } from '@/catalog'
import { isEvidenceUrl } from '@/lib/evidence'
import { CONDITION_KEYS, conditionProblems, type Conditions } from '@/lib/conditions'

// PR results are validated by trusted CI and inserted into Supabase on merge.
// This parser also supports the legacy browser prefill and exporting existing results as archive files.
// The browser only reads GitHub; privileged ingestion lives in frontend/scripts/pr-results.mjs.

export const RESULTS_DIR = 'results'
const API = 'https://api.github.com'

/** A result as committed to the repo. Mirrors ResultInput with catalog ids, plus the rig by id or name. */
export type ResultFile = Conditions & {
  /** The number at the end of the rig's URL on the site, or the rig's exact name. */
  rig: string
  /** Hardware id of the one part the run used. Leave out for a whole-rig result. */
  component?: string
  componentQuantity?: number
  model: string
  quant: string
  runtime: string
  runtimeVersion: string
  /** Flags and settings that change the number, as you would type them: "-fa 1, SYCL backend". */
  runtimeFlags?: string
  /** The custom runtime this ran on: the number at the end of its URL on the site, or its exact name. Omit for stock. */
  customRuntime?: string
  /** Repository-relative registration path added in the same PR. Mutually exclusive with customRuntime. */
  customRuntimeFile?: string
  /** The exact revision behind the number — a commit, a tag, or a build id. Stock or custom build. */
  revision?: string
  decodeTps: number
  promptTps?: number
  ttftMs?: number
  contextLength?: number
  batchSize?: number
  /** YYYY-MM-DD */
  runDate: string
  notes?: string
  /** Optional HTTPS link to logs, scripts, a gist, a report, or a repository. */
  evidenceUrl?: string
  /** The result's URL on the site once it has been submitted, so the archive entry and the live entry point at each other. */
  result?: string
}

export type PrRef = { number: number; url: string }
export const prUrl = (number: number) => `https://github.com/${REPO}/pull/${number}`

/** Accepts a PR number, "#12", or a PR URL on the site's repo. */
export function parsePrRef(input: string): PrRef | null {
  const text = input.trim()
  const bare = text.match(/^#?(\d+)$/)
  if (bare) return { number: Number(bare[1]), url: prUrl(Number(bare[1])) }
  try {
    const url = new URL(text)
    const match = url.pathname.match(/^\/([^/]+\/[^/]+)\/pull\/(\d+)/)
    if ((url.hostname === 'github.com' || url.hostname === 'www.github.com') && match && match[1].toLowerCase() === REPO.toLowerCase())
      return { number: Number(match[2]), url: prUrl(Number(match[2])) }
  } catch {
    /* not a URL */
  }
  return null
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Every key a result file may carry. results/schema.json lists the same keys; a test keeps them in step. */
export const RESULT_FILE_KEYS = [
  '$schema', 'rig', 'component', 'componentQuantity', 'model', 'quant', 'runtime', 'runtimeVersion', 'runtimeFlags',
  'customRuntime', 'customRuntimeFile', 'revision', 'decodeTps', 'promptTps', 'ttftMs', 'contextLength', 'batchSize',
  ...CONDITION_KEYS, 'runDate', 'notes', 'evidenceUrl', 'result',
] as const

/** How many single-letter edits turn a into b. Small strings only. */
function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    row = next
  }
  return row[b.length]
}

/** A misspelled field is otherwise dropped without a word, so name it and suggest the closest known key. */
function unknownFieldProblem(key: string): string {
  const lower = key.toLowerCase()
  const guess = RESULT_FILE_KEYS.map((known) => ({ known, distance: editDistance(lower, known.toLowerCase()) }))
    .filter(({ distance }) => distance <= 2)
    .sort((a, b) => a.distance - b.distance)[0]
  return `Unknown field: "${key}".${guess ? ` Did you mean "${guess.known}"?` : ''}`
}

/**
 * Reads a result file leniently: every field that can be used is kept, every problem is named, so a file with one
 * bad id still prefills the rest of the form. The CI check treats any problem as a failure.
 */
export function parseResultFile(raw: unknown): { file: Partial<ResultFile>; problems: string[] } {
  const problems: string[] = []
  const file: Partial<ResultFile> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { file, problems: ['The file must be a JSON object.'] }
  const data = raw as Record<string, unknown>
  for (const key of Object.keys(data)) {
    if (!(RESULT_FILE_KEYS as readonly string[]).includes(key)) problems.push(unknownFieldProblem(key))
  }
  const str = (key: keyof ResultFile, required = false) => {
    const value = data[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (value != null && value !== '') problems.push(`"${key}" must be text.`)
    else if (required) problems.push(`"${key}" is missing.`)
    return undefined
  }
  const num = (key: keyof ResultFile, required = false, integer = false) => {
    const value = data[key]
    if (value == null || value === '') {
      if (required) problems.push(`"${key}" is missing.`)
      return undefined
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || (integer && !Number.isInteger(value))) {
      problems.push(`"${key}" must be a ${integer ? 'whole ' : ''}number above zero.`)
      return undefined
    }
    return value
  }

  file.rig = str('rig', true)
  file.component = str('component')
  if (file.component && !HARDWARE_BY_ID[file.component]) problems.push(`"component" ${file.component} is not a hardware id in the catalog.`)
  file.componentQuantity = num('componentQuantity', false, true)
  if (file.componentQuantity && !file.component) problems.push('"componentQuantity" needs a "component".')
  file.model = str('model', true)
  const model = file.model ? MODEL_BY_ID[file.model] : undefined
  if (file.model && !model) problems.push(`"model" ${file.model} is not a model id in the catalog.`)
  file.quant = str('quant', true)
  if (file.quant && !QUANT_BY_ID[file.quant]) problems.push(`"quant" ${file.quant} is not a quant id in the catalog.`)
  file.runtime = str('runtime', true)
  if (file.runtime && !RUNTIME_BY_ID[file.runtime]) problems.push(`"runtime" ${file.runtime} is not a runtime id in the catalog.`)
  file.runtimeVersion = str('runtimeVersion', true)
  file.runtimeFlags = str('runtimeFlags')
  if (file.runtimeFlags && file.runtimeFlags.length > RUNTIME_FLAGS_MAX) problems.push(`"runtimeFlags" must be ${RUNTIME_FLAGS_MAX} characters or fewer.`)
  file.customRuntime = str('customRuntime')
  file.customRuntimeFile = str('customRuntimeFile')
  if ('customRuntimeFile' in data && !file.customRuntimeFile) problems.push('customRuntimeFile must be nonempty text.')
  if (file.customRuntimeFile && !/^custom-runtimes\/[a-z0-9-]+\/[a-z0-9][a-z0-9._-]*\.json$/i.test(file.customRuntimeFile)) problems.push('"customRuntimeFile" must be a registration path in this PR, without traversal.')
  if (data.customRuntimeFile !== undefined && data.customRuntime !== undefined) problems.push('Use customRuntime or customRuntimeFile, not both.')
  file.revision = str('revision')
  if (file.revision && file.revision.length > REVISION_MAX) problems.push(`"revision" must be ${REVISION_MAX} characters or fewer.`)
  file.decodeTps = num('decodeTps', true)
  file.promptTps = num('promptTps')
  file.ttftMs = num('ttftMs')
  file.contextLength = num('contextLength', false, true)
  file.batchSize = num('batchSize', false, true)
  // Conditions: checked together so the file and the form report the same problems.
  const conditions = Object.fromEntries(CONDITION_KEYS.filter((key) => data[key] != null).map((key) => [key, data[key]]))
  const conditionIssues = conditionProblems(conditions)
  problems.push(...conditionIssues)
  if (!conditionIssues.length) Object.assign(file, conditions)
  file.runDate = str('runDate', true)
  if (file.runDate && !DATE.test(file.runDate)) {
    problems.push('"runDate" must be YYYY-MM-DD.')
    file.runDate = undefined
  }
  file.notes = str('notes')
  file.evidenceUrl = str('evidenceUrl')
  if (file.evidenceUrl && !isEvidenceUrl(file.evidenceUrl)) problems.push('"evidenceUrl" must be a full HTTPS URL.')
  file.result = str('result')
  return { file, problems }
}

export type PrResultFile = { path: string; file: Partial<ResultFile>; problems: string[] }
export type PrResults = {
  pr: { number: number; url: string; title: string; author: string; state: 'open' | 'closed'; merged: boolean }
  files: PrResultFile[]
}

export class PrError extends Error {}

async function github<T>(path: string, accept = 'application/vnd.github+json'): Promise<T> {
  const response = await fetch(`${API}${path}`, { headers: { Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' } })
  if (response.status === 404) throw new PrError(`No such pull request on ${REPO}. The repo has to be public and the number right.`)
  if (response.status === 403 || response.status === 429) {
    if (response.headers.get('x-ratelimit-remaining') === '0') throw new PrError("GitHub's API limit for your network is used up. Try again in a few minutes.")
    throw new PrError('GitHub refused the request.')
  }
  if (!response.ok) throw new PrError(`GitHub answered ${response.status}.`)
  return (accept.includes('raw') ? response.text() : response.json()) as Promise<T>
}

type PrPayload = { number: number; html_url: string; title: string; state: 'open' | 'closed'; merged: boolean; user: { login: string } }
type PrFilePayload = { filename: string; status: string; contents_url: string }

/** The result files a pull request adds or changes, read through GitHub's public API. */
export async function fetchPrResults(ref: PrRef): Promise<PrResults> {
  const [pr, changed] = await Promise.all([
    github<PrPayload>(`/repos/${REPO}/pulls/${ref.number}`),
    github<PrFilePayload[]>(`/repos/${REPO}/pulls/${ref.number}/files?per_page=100`),
  ])
  const candidates = changed.filter((f) => f.status !== 'removed' && /^results\/[^/]+\/[^/]+\.json$/.test(f.filename))
  if (!candidates.length) throw new PrError(`That pull request adds no result file. Files live at ${RESULTS_DIR}/<your-handle>/<name>.json.`)
  const files = await Promise.all(
    candidates.map(async (f): Promise<PrResultFile> => {
      // contents_url carries the head commit's ref, so files on a fork's branch resolve too.
      const text = await github<string>(f.contents_url.replace(API, ''), 'application/vnd.github.raw+json')
      try {
        return { path: f.filename, ...parseResultFile(JSON.parse(text)) }
      } catch (error) {
        return { path: f.filename, file: {}, problems: [`Not valid JSON: ${error instanceof Error ? error.message : String(error)}`] }
      }
    }),
  )
  return { pr: { number: pr.number, url: pr.html_url, title: pr.title, author: pr.user.login, state: pr.state, merged: pr.merged }, files }
}

/** The file for a submitted (or about-to-be-submitted) result, in the order people read it. */
export function resultFileFor(r: Result | ResultInput, resultUrl?: string): ResultFile {
  const rig = 'rig' in r && r.rig ? r.rig.id : r.rigId
  return {
    rig,
    ...(r.componentId ? { component: r.componentId, componentQuantity: r.componentQuantity ?? 1 } : {}),
    model: r.modelId,
    quant: r.quant,
    runtime: r.runtimeId,
    runtimeVersion: r.runtimeVersion,
    ...(r.runtimeFlags ? { runtimeFlags: r.runtimeFlags } : {}),
    ...(r.customRuntimeId ? { customRuntime: r.customRuntimeId } : {}),
    ...(r.revision ? { revision: r.revision } : {}),
    decodeTps: r.decodeTps,
    ...(r.promptTps != null ? { promptTps: r.promptTps } : {}),
    ...(r.ttftMs != null ? { ttftMs: r.ttftMs } : {}),
    ...(r.contextLength != null ? { contextLength: r.contextLength } : {}),
    ...(r.batchSize != null ? { batchSize: r.batchSize } : {}),
    ...Object.fromEntries(CONDITION_KEYS.filter((key) => r[key] != null).map((key) => [key, r[key]])),
    runDate: r.runDate.slice(0, 10),
    ...(r.notes ? { notes: r.notes } : {}),
    ...(r.repoUrl?.trim() ? { evidenceUrl: r.repoUrl.trim() } : {}),
    ...(resultUrl ? { result: resultUrl } : {}),
  }
}

/**
 * GitHub's new-file page with the path and contents filled in. Someone without push access is offered a fork and a
 * pull request from there, which is the whole point.
 */
export function newResultFileUrl(handle: string, file: ResultFile): string {
  const name = `${file.runDate}-${file.model}-${file.quant}-${file.runtime}`.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()
  const params = new URLSearchParams({ filename: `${RESULTS_DIR}/${handle}/${name}.json`, value: `${JSON.stringify(file, null, 2)}\n` })
  return `https://github.com/${REPO}/new/main?${params}`
}

export function parseCustomRuntimeFile(raw: unknown): { file: Record<string, string>; problems: string[] } {
  const file: Record<string, string> = {}
  const problems: string[] = []
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { file, problems: ['The file must be a JSON object.'] }
  const data = raw as Record<string, unknown>
  const limits: Record<string, number> = { runtime: 120, name: 120, repoUrl: 8192, summary: 280, notes: 5000 }
  for (const key of Object.keys(data)) {
    if (key !== '$schema' && !Object.hasOwn(limits, key)) problems.push(`Unknown field: ${key}.`)
  }
  if ('$schema' in data && typeof data.$schema !== 'string') problems.push('$schema must be text.')
  for (const [key, limit] of Object.entries(limits)) {
    if (key === 'notes' && data[key] === undefined) continue
    if (typeof data[key] !== 'string' || !data[key].trim()) { problems.push(`${key} must be nonempty text.`); continue }
    file[key] = data[key].trim()
    if (file[key].length > limit) problems.push(`${key} must be ${limit} characters or fewer.`)
  }
  if (file.runtime && !RUNTIME_BY_ID[file.runtime]) problems.push('runtime must be an existing catalog runtime ID.')
  if (file.repoUrl && !isEvidenceUrl(file.repoUrl.replace(/^http:/i, 'https:'))) problems.push('repoUrl must be a full HTTP(S) URL without credentials.')
  return { file, problems }
}
