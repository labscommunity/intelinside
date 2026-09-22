import type {
  Api, BestRank, BoardKind, BoardParams, BoardResponse, BoardRow, BoardUnit, ChartBar, FlagReason, HardwareDetail, HardwareItem, HomeResponse, Model, ModelSummary,
  Moderation, Page, Quant, Result, ResultDetail, ResultInput, Rig, RigDetail, RigSummary,
  Runtime, TopResultsResponse, User, UserStats, Verification,
  CustomRuntime, CustomRuntimeInput,
} from './types'
import { ApiError, BUILD_SUMMARY_MAX } from './types'
import { hardwareChart } from './hardware-chart'
import { isEvidenceUrl } from '@/lib/evidence'
import { hostIn } from '@/lib/hardware'
import { HARDWARE_BY_ID, MODELS, MODEL_BY_ID, QUANTS, QUANT_BY_ID, RUNTIMES, RUNTIME_BY_ID, VISIBLE_HARDWARE } from '@/catalog'
import { createSeed, rigSummaryLine, type SeedDb } from '@/mocks/seed'

// In-memory implementation of the API contract. Same ranking, thresholds, and
// permission rules the backend will enforce, so every flow is clickable offline.

const CONFIRM_THRESHOLD = 3
const FLAG_THRESHOLD = 3
const LATENCY_MS = 160
const SESSION_KEY = 'intelinside.mock.session'

/** The seed, or with VITE_MOCK_EMPTY=true the seed's users alone: the site before anyone has registered a rig. */
function seed(): SeedDb {
  const s = createSeed()
  if (import.meta.env.VITE_MOCK_EMPTY === 'true') return { ...s, rigs: [], results: [], confirmations: new Map(), flags: new Map() }
  return s
}

let db: SeedDb = seed()
let sessionUserId: string | null = readSession()
let idCounter = 1000

/** Make a real OAuth identity usable with the in-memory API during frontend development. */
export function syncMockSession(user: User | null): User | null {
  if (!user) {
    writeSession(null)
    return null
  }

  const existing = db.users.find((candidate) => candidate.id === user.id || candidate.handle === user.handle)
  if (existing) {
    Object.assign(existing, user, { id: existing.id })
    writeSession(existing.id)
    return { ...existing }
  }

  db.users.push(user)
  writeSession(user.id)
  return { ...user }
}

function readSession(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}
function writeSession(id: string | null) {
  sessionUserId = id
  try {
    if (id) localStorage.setItem(SESSION_KEY, id)
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    /* private mode */
  }
}

const delay = <T,>(v: T): Promise<T> => new Promise((res) => setTimeout(() => res(v), LATENCY_MS))
const fail = (code: string, message: string, status: number, fields?: Record<string, string>) =>
  Promise.reject(new ApiError(code, message, status, fields))
const nowIso = () => new Date().toISOString()
const newId = (p: string) => `${p}-${++idCounter}`

const userById = (id: string) => db.users.find((u) => u.id === id)
const publicUser = (u: User): User => ({ id: u.id, handle: u.handle, name: u.name, avatarUrl: u.avatarUrl, bio: u.bio, createdAt: u.createdAt })
const currentUser = () => (sessionUserId ? userById(sessionUserId) ?? null : null)
const requireUser = (): User => {
  const u = currentUser()
  if (!u) throw new ApiError('unauthorized', 'Sign in to do that.', 401)
  return u
}
const rigOf = (r: Result) => db.rigs.find((x) => x.id === r.rigId)!
const visibleResults = () => db.results.filter((r) => !r.moderation.hidden)
const canSee = (r: Result) => !r.moderation.hidden || r.submitterId === sessionUserId

function rigSummary(rig: Rig): RigSummary {
  const rs = visibleResults().filter((r) => r.rigId === rig.id)
  return {
    id: rig.id, name: rig.name, photoUrl: rig.photoUrl, summary: rig.summary,
    owner: publicUser(userById(rig.ownerId)!),
    components: rig.components.map(({ hardwareId, quantity }) => ({ hardwareId, quantity })),
    resultsCount: rs.length,
    bestTps: rs.length ? Math.max(...rs.map((r) => r.decodeTps)) : undefined,
  }
}

function hydrateRig(rig: Rig): Rig {
  return {
    ...rig,
    owner: publicUser(userById(rig.ownerId)!),
    components: rig.components.map((c) => ({ ...c, hardware: HARDWARE_BY_ID[c.hardwareId] })),
  }
}

/** Counts a build carries wherever it is shown: how much has been posted on it, and by how many machines. */
function hydrateBuild(b: CustomRuntime): CustomRuntime {
  const mine = db.results.filter((r) => canSee(r) && r.customRuntimeId === b.id)
  return {
    ...b,
    owner: publicUser(userById(b.ownerId)!),
    runtime: RUNTIME_BY_ID[b.runtimeId],
    resultsCount: mine.length,
    rigsCount: new Set(mine.map((r) => r.rigId)).size,
    bestTps: mine.length ? Math.max(...mine.map((r) => r.decodeTps)) : undefined,
  }
}

/** Mirrors the database's checks so the mock refuses the same shapes the server would. */
function validateBuild(input: Partial<CustomRuntimeInput>, forCreate: boolean): Record<string, string> {
  const e: Record<string, string> = {}
  const need = (k: 'runtimeId' | 'name' | 'repoUrl' | 'summary', msg: string) => {
    if (forCreate && !String(input[k] ?? '').trim()) e[k] = msg
  }
  need('runtimeId', 'Pick the runtime it is based on.')
  need('name', 'Name the build.')
  need('repoUrl', 'Link the fork or source.')
  need('summary', 'Say in one line what changed.')
  if (input.runtimeId && !RUNTIME_BY_ID[input.runtimeId]) e.runtimeId = 'Unknown runtime.'
  if (input.repoUrl && !/^https?:\/\/\S+$/.test(input.repoUrl.trim())) e.repoUrl = 'Enter a full URL, starting with https://.'
  if (input.name && input.name.trim().length > 120) e.name = 'Use 120 characters or fewer.'
  if (input.summary && input.summary.trim().length > BUILD_SUMMARY_MAX) e.summary = `Use ${BUILD_SUMMARY_MAX} characters or fewer.`
  return e
}

function hydrateResult(r: Result): Result {
  const confs = db.confirmations.get(r.id)
  const fl = db.flags.get(r.id)
  return {
    ...r,
    execution: r.customRuntimeId ? 'modified' : 'stock',
    customRuntime: r.customRuntimeId ? db.customRuntimes.find((b) => b.id === r.customRuntimeId) : undefined,
    submitter: publicUser(userById(r.submitterId)!),
    rig: rigSummary(rigOf(r)),
    component: r.componentId ? HARDWARE_BY_ID[r.componentId] : undefined,
    componentHost: r.componentId ? hostIn(rigOf(r).components, r.componentId) : undefined,
    verification: { ...r.verification, confirmedByMe: !!sessionUserId && !!confs?.has(sessionUserId) },
    moderation: { ...r.moderation, flaggedByMe: !!sessionUserId && !!fl?.has(sessionUserId) },
  }
}

// ----- ranking -----------------------------------------------------------

const unitKey = (r: Result) => (r.componentId ? `${r.componentId}x${r.componentQuantity ?? 1}` : `rig:${r.rigId}`)

function unitFor(r: Result): BoardUnit {
  if (!r.componentId) return { kind: 'rig', rig: rigSummary(rigOf(r)) }
  return { kind: 'component', hardware: HARDWARE_BY_ID[r.componentId], quantity: r.componentQuantity ?? 1 }
}
export function unitLabel(u: BoardUnit): string {
  return u.kind === 'rig' ? u.rig.name : `${u.quantity > 1 ? `${u.quantity}× ` : ''}${u.hardware.name}`
}
const unitHref = (u: BoardUnit) => (u.kind === 'rig' ? `/rigs/${u.rig.id}` : `/hardware/${u.hardware.id}`)

function bestPerKey(items: Result[], key: (r: Result) => string): Result[] {
  const best = new Map<string, Result>()
  for (const r of items) {
    const k = key(r)
    const cur = best.get(k)
    if (!cur || r.decodeTps > cur.decodeTps || (r.decodeTps === cur.decodeTps && r.runDate < cur.runDate)) best.set(k, r)
  }
  return [...best.values()].sort((a, b) => b.decodeTps - a.decodeTps || a.runDate.localeCompare(b.runDate))
}

function matchesFilter(r: Result, p: Partial<BoardParams>): boolean {
  if (p.runtime?.length && !p.runtime.includes(r.runtimeId)) return false
  if (p.verification && r.verification.status !== p.verification) return false
  if (!p.includeModified && r.execution === 'modified') return false
  const rig = rigOf(r)
  if (p.vendor) {
    if (r.componentId) {
      if (HARDWARE_BY_ID[r.componentId].vendor !== p.vendor) return false
    } else if (!rig.components.some((c) => HARDWARE_BY_ID[c.hardwareId]?.vendor === p.vendor)) return false
  }
  if (p.type && r.componentId && HARDWARE_BY_ID[r.componentId].type !== p.type) return false
  if (p.q) {
    const q = p.q.toLowerCase()
    const label = r.componentId ? HARDWARE_BY_ID[r.componentId].name : rig.name
    const handle = userById(r.submitterId)?.handle ?? ''
    if (![label, handle, rig.summary].some((s) => s.toLowerCase().includes(q))) return false
  }
  return true
}

function bestRows(modelId: string, quant: string, kind: BoardKind, p: Partial<BoardParams> = {}): Result[] {
  const items = visibleResults().filter(
    (r) => r.modelId === modelId && r.quant === quant && (kind === 'rigs' ? !r.componentId : !!r.componentId) && matchesFilter(r, p),
  )
  return bestPerKey(items, unitKey)
}

function boardRows(modelId: string, quant: string, p: BoardParams): BoardRow[] {
  return bestRows(modelId, quant, p.kind, p).map((r, i) => ({ rank: i + 1, result: hydrateResult(r), unit: unitFor(r) }))
}

function chartFromRows(rows: BoardRow[]): ChartBar[] {
  return rows.slice(0, 10).map((row) => ({ label: unitLabel(row.unit), tps: row.result.decodeTps, runtimeId: row.result.runtimeId, href: unitHref(row.unit) }))
}

const modelQuantLabel = (r: Result) => `${MODEL_BY_ID[r.modelId]?.name ?? r.modelId} ${QUANT_BY_ID[r.quant]?.label ?? r.quant}`

function bestPerModelQuant(items: Result[], withPart = false): ChartBar[] {
  const best = bestPerKey(items, (r) => `${r.modelId}/${r.quant}${withPart && r.componentId ? `/${r.componentId}x${r.componentQuantity ?? 1}` : ''}`)
  return best.slice(0, 10).map((r) => ({
    label: withPart && r.componentId ? `${modelQuantLabel(r)} · ${unitLabel(unitFor(r))}` : modelQuantLabel(r),
    tps: r.decodeTps, runtimeId: r.runtimeId, href: `/results/${r.id}`,
  }))
}

function userStats(u: User): UserStats {
  const mine = visibleResults().filter((r) => r.submitterId === u.id)
  let bestRank: BestRank | undefined
  for (const m of MODELS)
    for (const q of m.quants)
      for (const kind of ['rigs', 'components'] as BoardKind[]) {
        const rows = bestRows(m.id, q, kind)
        const i = rows.findIndex((r) => r.submitterId === u.id)
        if (i >= 0 && (!bestRank || i + 1 < bestRank.position)) bestRank = { modelId: m.id, quant: q, kind, position: i + 1 }
      }
  let confirmationsGiven = 0
  for (const set of db.confirmations.values()) if (set.has(u.id)) confirmationsGiven++
  return {
    results: mine.length,
    rigs: db.rigs.filter((r) => r.ownerId === u.id).length,
    bestRank,
    confirmationsGiven,
  }
}

function paginate<T>(items: T[], limit = 25, cursor?: string): Page<T> {
  const start = cursor ? parseInt(cursor, 10) || 0 : 0
  const slice = items.slice(start, start + limit)
  return { items: slice, nextCursor: start + limit < items.length ? String(start + limit) : undefined }
}

function withCounts(h: HardwareItem): HardwareItem {
  return {
    ...h,
    resultsCount: visibleResults().filter((r) => r.componentId === h.id).length,
    rigsCount: db.rigs.filter((rig) => rig.components.some((c) => c.hardwareId === h.id)).length,
  }
}

function recomputeVerification(r: Result) {
  const n = db.confirmations.get(r.id)?.size ?? 0
  r.verification = { status: n >= CONFIRM_THRESHOLD ? 'community_verified' : 'self_reported', confirmations: n }
}
function recomputeModeration(r: Result) {
  const f = db.flags.get(r.id)
  const n = f?.size ?? 0
  r.moderation = { flags: n, hidden: n >= FLAG_THRESHOLD, reasons: f ? Array.from(new Set(f.values())) : [] }
}

function validateResult(input: Partial<ResultInput>, forCreate: boolean): Record<string, string> {
  const errors: Record<string, string> = {}
  const need = (k: keyof ResultInput, msg: string) => {
    if (forCreate && (input[k] == null || input[k] === '')) errors[k] = msg
  }
  need('modelId', 'Pick a model.')
  need('quant', 'Pick a quantization.')
  need('runtimeId', 'Pick a runtime.')
  need('runtimeVersion', 'Enter the runtime version.')
  need('rigId', 'Pick a rig.')
  need('runDate', 'Enter the run date.')
  if (input.modelId && !MODEL_BY_ID[input.modelId]) errors.modelId = 'Unknown model.'
  if (input.modelId && input.quant && MODEL_BY_ID[input.modelId] && !MODEL_BY_ID[input.modelId].quants.includes(input.quant)) errors.quant = 'That quant has no board for this model.'
  if (input.decodeTps != null && !(input.decodeTps > 0)) errors.decodeTps = 'Decode tok/s must be above zero.'
  if (forCreate && input.decodeTps == null) errors.decodeTps = 'Enter decode tok/s.'
  if (input.repoUrl?.trim() && !isEvidenceUrl(input.repoUrl.trim())) errors.repoUrl = 'Enter a full HTTPS URL.'
  if (input.runDate && new Date(input.runDate).getTime() > Date.now() + 86400000) errors.runDate = 'Run date cannot be in the future.'
  if (input.rigId) {
    const rig = db.rigs.find((r) => r.id === input.rigId)
    if (!rig) errors.rigId = 'Unknown rig.'
    else if (input.componentId && !rig.components.some((c) => c.hardwareId === input.componentId)) errors.componentId = 'That part is not in this rig.'
  }
  return errors
}

// ----- the API -----------------------------------------------------------

export const mockApi: Api = {
  mode: 'mock',

  async me() {
    const u = currentUser()
    return delay(u ? { ...publicUser(u), stats: userStats(u) } : null)
  },
  signInUrl: () => '#sign-in',
  async mockSignIn(handle) {
    const u = db.users.find((x) => x.handle === handle)
    if (!u) return fail('not_found', 'No such user.', 404)
    writeSession(u.id)
    return delay({ ...publicUser(u), stats: userStats(u) })
  },
  async mockUsers() {
    return delay(db.users.map(publicUser))
  },
  async signOut() {
    writeSession(null)
    return delay(undefined)
  },

  async models() {
    return delay(
      MODELS.map((m) => ({
        ...m,
        resultCounts: Object.fromEntries(m.quants.map((q) => [q, visibleResults().filter((r) => r.modelId === m.id && r.quant === q).length])),
      })),
    )
  },
  async model(id) {
    const m = MODEL_BY_ID[id]
    if (!m) return fail('not_found', 'No such model.', 404)
    const models = await mockApi.models()
    return models.find((x) => x.id === id) as Model
  },
  async runtimes() {
    return delay(RUNTIMES as Runtime[])
  },
  async quants() {
    return delay(QUANTS as Quant[])
  },
  async hardware(params = {}) {
    let items = VISIBLE_HARDWARE.map(withCounts)
    if (params.type) items = items.filter((h) => h.type === params.type)
    if (params.vendor) items = items.filter((h) => h.vendor === params.vendor)
    if (params.q) {
      const q = params.q.toLowerCase()
      items = items.filter((h) => `${h.vendor} ${h.name} ${h.series ?? ''}`.toLowerCase().includes(q))
    }
    return delay(paginate(items, params.limit ?? 100, params.cursor))
  },
  async hardwareItem(id) {
    const h = VISIBLE_HARDWARE.find((item) => item.id === id)
    if (!h) return fail('not_found', 'No such hardware.', 404)
    const results = visibleResults().filter((r) => r.componentId === id).sort((a, b) => b.decodeTps - a.decodeTps)
    const rigs = db.rigs.filter((rig) => rig.components.some((c) => c.hardwareId === id)).map(rigSummary)
    const detail: HardwareDetail = { ...withCounts(h), chart: hardwareChart(results), rigs, results: results.map(hydrateResult) }
    return delay(detail)
  },

  async board(modelId, quant, params) {
    if (!MODEL_BY_ID[modelId]) return fail('not_found', 'No such model.', 404)
    if (!MODEL_BY_ID[modelId].quants.includes(quant)) return fail('not_found', 'No board for that quant.', 404)
    const rows = boardRows(modelId, quant, params)
    const page = paginate(rows, params.limit ?? 25, params.cursor)
    const res: BoardResponse = {
      board: { modelId, quant, kind: params.kind, total: rows.length },
      items: page.items, nextCursor: page.nextCursor, chart: chartFromRows(rows),
    }
    return delay(res)
  },

  async rigs(params = {}) {
    let rigs = db.rigs.slice()
    if (params.owner) rigs = rigs.filter((r) => userById(r.ownerId)?.handle === params.owner)
    if (params.hardware) rigs = rigs.filter((r) => r.components.some((c) => c.hardwareId === params.hardware))
    let items = rigs.map(rigSummary)
    const sort = params.sort ?? 'newest'
    if (sort === 'results') items.sort((a, b) => b.resultsCount - a.resultsCount)
    else if (sort === 'tps') items.sort((a, b) => (b.bestTps ?? 0) - (a.bestTps ?? 0))
    else items = rigs.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(rigSummary)
    return delay(paginate(items, params.limit ?? 24, params.cursor))
  },
  async rig(id) {
    const rig = db.rigs.find((r) => r.id === id)
    if (!rig) return fail('not_found', 'No such rig.', 404)
    const results = db.results.filter((r) => r.rigId === id && canSee(r)).sort((a, b) => b.runDate.localeCompare(a.runDate))
    const detail: RigDetail = { ...hydrateRig(rig), results: results.map(hydrateResult), chart: bestPerModelQuant(results.filter((r) => !r.moderation.hidden), true) }
    return delay(detail)
  },
  async createRig(input) {
    const u = requireUser()
    const errors: Record<string, string> = {}
    if (!input.name?.trim()) errors.name = 'Give the rig a name.'
    if (!input.components?.length) errors.components = 'Add at least one component.'
    if (input.components?.some((c) => !HARDWARE_BY_ID[c.hardwareId] || c.quantity < 1)) errors.components = 'Unknown part or bad quantity.'
    if (Object.keys(errors).length) return fail('validation', 'Fix the highlighted fields.', 400, errors)
    const rig: Rig = {
      id: newId('rig'), ownerId: u.id, name: input.name.trim(), os: input.os?.trim() ?? '', photoUrl: input.photoUrl, notes: input.notes,
      components: input.components.map((c) => ({ hardwareId: c.hardwareId, quantity: c.quantity })),
      summary: rigSummaryLine(input.components), createdAt: nowIso(), updatedAt: nowIso(),
    }
    db.rigs.unshift(rig)
    return delay(hydrateRig(rig))
  },
  async updateRig(id, input) {
    const u = requireUser()
    const rig = db.rigs.find((r) => r.id === id)
    if (!rig) return fail('not_found', 'No such rig.', 404)
    if (rig.ownerId !== u.id) return fail('forbidden', 'Only the owner can edit this rig.', 403)
    if (input.name != null) rig.name = input.name.trim()
    if (input.os != null) rig.os = input.os.trim()
    if (input.photoUrl !== undefined) rig.photoUrl = input.photoUrl
    if (input.notes !== undefined) rig.notes = input.notes
    if (input.components) {
      rig.components = input.components.map((c) => ({ hardwareId: c.hardwareId, quantity: c.quantity }))
      rig.summary = rigSummaryLine(rig.components)
    }
    rig.updatedAt = nowIso()
    return delay(hydrateRig(rig))
  },
  async deleteRig(id) {
    const u = requireUser()
    const rig = db.rigs.find((r) => r.id === id)
    if (!rig) return fail('not_found', 'No such rig.', 404)
    if (rig.ownerId !== u.id) return fail('forbidden', 'Only the owner can delete this rig.', 403)
    db.rigs = db.rigs.filter((r) => r.id !== id)
    db.results = db.results.filter((r) => r.rigId !== id)
    return delay(undefined)
  },

  async runtimeSummaries() {
    const visible = db.results.filter(canSee)
    return delay(RUNTIMES.map((runtime) => {
      const mine = visible.filter((r) => r.runtimeId === runtime.id)
      return {
        ...runtime,
        resultsCount: mine.length,
        buildsCount: db.customRuntimes.filter((b) => b.runtimeId === runtime.id).length,
        bestTps: mine.length ? Math.max(...mine.map((r) => r.decodeTps)) : undefined,
      }
    }))
  },
  async customRuntimes(params = {}) {
    let items = db.customRuntimes.slice()
    if (params.runtime) items = items.filter((b) => b.runtimeId === params.runtime)
    if (params.owner) items = items.filter((b) => userById(b.ownerId)?.handle === params.owner)
    const mine = sessionUserId
    items = items
      .map(hydrateBuild)
      .sort((a, b) => Number(b.ownerId === mine) - Number(a.ownerId === mine) || b.createdAt.localeCompare(a.createdAt))
    return delay({ items })
  },
  async customRuntime(id) {
    const build = db.customRuntimes.find((b) => b.id === id)
    if (!build) return fail('not_found', 'No such build.', 404)
    const results = db.results.filter((r) => canSee(r) && r.customRuntimeId === id).sort((a, b) => b.decodeTps - a.decodeTps)
    return delay({ ...hydrateBuild(build), results: results.map(hydrateResult), chart: bestPerModelQuant(results, true) })
  },
  async createCustomRuntime(input) {
    const u = requireUser()
    const errors = validateBuild(input, true)
    if (Object.keys(errors).length) return fail('validation', 'Fix the highlighted fields.', 400, errors)
    const build: CustomRuntime = {
      id: newId('build'), ownerId: u.id, runtimeId: input.runtimeId!,
      name: input.name!.trim(), repoUrl: input.repoUrl!.trim(), summary: input.summary!.trim(),
      notes: input.notes?.trim() || undefined, createdAt: nowIso(), updatedAt: nowIso(),
    }
    db.customRuntimes.unshift(build)
    return delay(hydrateBuild(build))
  },
  async updateCustomRuntime(id, input) {
    const u = requireUser()
    const build = db.customRuntimes.find((b) => b.id === id)
    if (!build) return fail('not_found', 'No such build.', 404)
    if (build.ownerId !== u.id) return fail('forbidden', 'Only the owner can edit this build.', 403)
    const errors = validateBuild(input, false)
    if (Object.keys(errors).length) return fail('validation', 'Fix the highlighted fields.', 400, errors)
    Object.assign(build, {
      ...(input.runtimeId ? { runtimeId: input.runtimeId } : {}),
      ...(input.name ? { name: input.name.trim() } : {}),
      ...(input.repoUrl ? { repoUrl: input.repoUrl.trim() } : {}),
      ...(input.summary ? { summary: input.summary.trim() } : {}),
      ...('notes' in input ? { notes: input.notes?.trim() || undefined } : {}),
      updatedAt: nowIso(),
    })
    return delay(hydrateBuild(build))
  },

  async results(params = {}) {
    let items = db.results.filter(canSee)
    if (params.rig) items = items.filter((r) => r.rigId === params.rig)
    if (params.hardware) items = items.filter((r) => r.componentId === params.hardware)
    if (params.model) items = items.filter((r) => r.modelId === params.model)
    if (params.quant) items = items.filter((r) => r.quant === params.quant)
    if (params.runtime) items = items.filter((r) => r.runtimeId === params.runtime)
    if (params.user) items = items.filter((r) => userById(r.submitterId)?.handle === params.user)
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const page = paginate(items, params.limit ?? 25, params.cursor)
    return delay({ ...page, items: page.items.map(hydrateResult) })
  },
  async result(id) {
    const r = db.results.find((x) => x.id === id)
    if (!r || !canSee(r)) return fail('not_found', 'No such result.', 404)
    const kind: BoardKind = r.componentId ? 'components' : 'rigs'
    const rows = bestRows(r.modelId, r.quant, kind, { includeModified: r.execution === 'modified' })
    const i = rows.findIndex((x) => unitKey(x) === unitKey(r))
    const detail: ResultDetail = { ...hydrateResult(r), rank: i >= 0 ? { kind, position: i + 1, boardSize: rows.length } : undefined }
    return delay(detail)
  },
  async createResult(input) {
    const u = requireUser()
    const errors = validateResult(input, true)
    const rig = db.rigs.find((r) => r.id === input.rigId)
    if (rig && rig.ownerId !== u.id) errors.rigId = 'You can only submit results for your own rigs.'
    if (Object.keys(errors).length) return fail('validation', 'Fix the highlighted fields.', 400, errors)
    const r: Result = {
      ...input, id: newId('res'), submitterId: u.id,
      repoUrl: input.repoUrl?.trim() || undefined,
      componentQuantity: input.componentId ? input.componentQuantity ?? 1 : undefined,
      execution: input.customRuntimeId ? 'modified' : 'stock',
      verification: { status: 'self_reported', confirmations: 0 }, moderation: { flags: 0, hidden: false },
      createdAt: nowIso(), updatedAt: nowIso(),
    }
    db.results.unshift(r)
    return delay(hydrateResult(r))
  },
  async updateResult(id, input) {
    const u = requireUser()
    const r = db.results.find((x) => x.id === id)
    if (!r) return fail('not_found', 'No such result.', 404)
    if (r.submitterId !== u.id) return fail('forbidden', 'Only the submitter can edit this result.', 403)
    const errors = validateResult({ ...r, ...input }, false)
    if (Object.keys(errors).length) return fail('validation', 'Fix the highlighted fields.', 400, errors)
    Object.assign(r, input, { updatedAt: nowIso() })
    if ('repoUrl' in input) r.repoUrl = input.repoUrl?.trim() || undefined
    // Any edit resets verification.
    db.confirmations.set(r.id, new Set())
    recomputeVerification(r)
    return delay(hydrateResult(r))
  },
  async deleteResult(id) {
    const u = requireUser()
    const r = db.results.find((x) => x.id === id)
    if (!r) return fail('not_found', 'No such result.', 404)
    if (r.submitterId !== u.id) return fail('forbidden', 'Only the submitter can delete this result.', 403)
    db.results = db.results.filter((x) => x.id !== id)
    return delay(undefined)
  },
  async confirmResult(id) {
    const u = requireUser()
    const r = db.results.find((x) => x.id === id)
    if (!r) return fail('not_found', 'No such result.', 404)
    if (r.submitterId === u.id) return fail('forbidden', 'You cannot confirm your own result.', 403)
    const set = db.confirmations.get(id) ?? new Set<string>()
    if (set.has(u.id)) set.delete(u.id)
    else set.add(u.id)
    db.confirmations.set(id, set)
    recomputeVerification(r)
    const v: Verification = { ...r.verification, confirmedByMe: set.has(u.id) }
    return delay(v)
  },
  async flagResult(id, reason) {
    const u = requireUser()
    const r = db.results.find((x) => x.id === id)
    if (!r) return fail('not_found', 'No such result.', 404)
    if (r.submitterId === u.id) return fail('forbidden', 'You cannot flag your own result.', 403)
    const map = db.flags.get(id) ?? new Map<string, FlagReason>()
    if (map.has(u.id)) map.delete(u.id)
    else map.set(u.id, reason)
    db.flags.set(id, map)
    recomputeModeration(r)
    const m: Moderation = { ...r.moderation, flaggedByMe: map.has(u.id) }
    return delay(m)
  },

  async user(handle) {
    const u = db.users.find((x) => x.handle === handle)
    if (!u) return fail('not_found', 'No such user.', 404)
    return delay({ ...publicUser(u), stats: userStats(u) })
  },
  async userRigs(handle) {
    return mockApi.rigs({ owner: handle, limit: 100 })
  },
  async userResults(handle) {
    return mockApi.results({ user: handle, limit: 100 })
  },

  async modelSummaries() {
    const vis = visibleResults()
    const models = await mockApi.models()
    const out: ModelSummary[] = models.map((m) => {
      const quant = m.quants.map((q) => ({ q, n: vis.filter((r) => r.modelId === m.id && r.quant === q).length })).sort((a, b) => b.n - a.n)[0].q
      // The rigs board when it has rows, else the components board: most results name a part, not a whole rig.
      const rigs = boardRows(m.id, quant, { kind: 'rigs' })
      const components = rigs.length ? [] : boardRows(m.id, quant, { kind: 'components' })
      const [kind, rows]: [BoardKind, BoardRow[]] = rigs.length || !components.length ? ['rigs', rigs] : ['components', components]
      const best = m.quants
        .flatMap((q) => [boardRows(m.id, q, { kind: 'rigs' })[0], boardRows(m.id, q, { kind: 'components' })[0]])
        .filter(Boolean)
        .sort((a, b) => b.result.decodeTps - a.result.decodeTps)[0]
      return { model: m, board: { modelId: m.id, quant, kind, total: rows.length }, top: rows.slice(0, 3), best }
    })
    return delay(out)
  },
  async home() {
    const vis = visibleResults()
    const res: HomeResponse = {
      stats: { results: vis.length, rigs: db.rigs.length, hardware: VISIBLE_HARDWARE.length, members: db.users.length },
      topRigs: db.rigs.map(rigSummary).sort((a, b) => (b.bestTps ?? 0) - (a.bestTps ?? 0)).slice(0, 6),
    }
    return delay(res)
  },
  async topResults(params = {}) {
    let items = visibleResults().filter((r) => r.execution !== 'modified')
    if (params.model) items = items.filter((r) => r.modelId === params.model)
    if (params.quant) items = items.filter((r) => r.quant === params.quant)
    const best = bestPerKey(items, (r) => `${unitKey(r)}|${r.modelId}|${r.quant}`)
    const rows = best.slice(0, params.limit ?? 10).map((r, i) => ({ rank: i + 1, result: hydrateResult(r), unit: unitFor(r) }))
    const res: TopResultsResponse = {
      items: rows,
      chart: rows.map((row) => ({ label: `${unitLabel(row.unit)} · ${modelQuantLabel(row.result)}`, tps: row.result.decodeTps, runtimeId: row.result.runtimeId, href: `/results/${row.result.id}` })),
      total: best.length,
    }
    return delay(res)
  },
  async upload(file) {
    return delay({ url: URL.createObjectURL(file) })
  },
}

/** Reset the in-memory database to the seed. Handy from the console during review. */
export function resetMockDb() {
  db = seed()
}
