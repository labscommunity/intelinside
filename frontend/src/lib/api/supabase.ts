import { supabase, signOutSupabase } from '@/lib/auth'
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity'
import { hostIn } from '@/lib/hardware'
import { HARDWARE_BY_ID, MODELS, MODEL_BY_ID, QUANTS, QUANT_BY_ID, RUNTIMES, RUNTIME_BY_ID, VISIBLE_HARDWARE } from '@/catalog'
import type {
  Api, BestRank, BoardKind, BoardParams, BoardResponse, BoardRow, BoardUnit, ChartBar, FlagReason,
  HardwareDetail, HardwareItem, HomeResponse, ModelSummary, Moderation, Page, Result,
  ResultDetail, ResultInput, Rig, RigDetail, RigSummary, TopResultsResponse, User, UserStats,
  CustomRuntime,
} from './types'
import { ApiError, BUILD_SUMMARY_MAX, REVISION_MAX, RUNTIME_FLAGS_MAX } from './types'
import { hardwareChart } from './hardware-chart'

type ProfileRow = {
  id: string
  handle: string
  name: string | null
  avatar_url: string
  bio: string | null
  created_at: string
}
type RigRow = {
  id: number | string
  owner_id: string
  name: string
  os: string
  photo_path: string | null
  notes: string | null
  created_at: string
  updated_at: string
}
type ComponentRow = { rig_id: number | string; hardware_id: string; quantity: number }
type ResultRow = {
  id: number | string
  submitter_id: string
  model_id: string
  quant_id: string
  runtime_id: string
  runtime_version: string
  runtime_flags: string | null
  custom_runtime_id: number | string | null
  revision: string | null
  rig_id: number | string
  component_id: string | null
  component_quantity: number | null
  decode_tps: number | string
  prompt_tps: number | string | null
  ttft_ms: number | string | null
  context_length: number | null
  batch_size: number | null
  notes: string | null
  repo_url: string | null
  source_pr_url: string | null
  run_date: string
  verification_status: 'self_reported' | 'community_verified'
  confirmations_count: number
  flags_count: number
  hidden: boolean
  created_at: string
  updated_at: string
}
type CustomRuntimeRow = {
  id: number | string
  owner_id: string
  runtime_id: string
  name: string
  repo_url: string
  summary: string
  notes: string | null
  created_at: string
  updated_at: string
}
type ConfirmationRow = { result_id: number | string; user_id: string }
type FlagRow = { result_id: number | string; user_id: string; reason: FlagReason }
type Snapshot = {
  userId: string | null
  profiles: ProfileRow[]
  rigs: RigRow[]
  components: ComponentRow[]
  results: ResultRow[]
  customRuntimes: CustomRuntimeRow[]
  confirmations: ConfirmationRow[]
  flags: FlagRow[]
}

const textMatcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
})

const RIG_PHOTOS_BUCKET = 'rig-photos'

const requiredClient = () => {
  if (!supabase) throw new ApiError('not_configured', 'Supabase is not configured.', 500)
  return supabase
}

function apiError(error: { code?: string; message: string; details?: string } | null | undefined): ApiError {
  const code = error?.code ?? 'database_error'
  const status = code === '42501' ? 403 : code === 'PGRST116' ? 404 : code.startsWith('23') ? 400 : 500
  return new ApiError(code, error?.message ?? 'The database request failed.', status)
}

async function rows<T>(request: PromiseLike<{ data: unknown; error: { code?: string; message: string; details?: string } | null }>): Promise<T> {
  const { data, error } = await request
  if (error) throw apiError(error)
  return data as T
}

/**
 * A table the page can be drawn without. A feature's table being unavailable — most likely a migration that has
 * not reached this project yet — should cost that feature, not every page: the boards do not need to know about
 * custom runtimes in order to rank results. Core tables are deliberately not routed through this, because without
 * profiles, rigs, components or results there is no page to draw and failing loudly is the honest outcome.
 */
async function optionalRows<T>(what: string, request: PromiseLike<{ data: unknown; error: { code?: string; message: string; details?: string } | null }>): Promise<T[]> {
  try {
    return await rows<T[]>(request)
  } catch (error) {
    console.error(`Could not load ${what}; continuing without it.`, error)
    return []
  }
}

function moderateText(entries: Array<[field: string, value: string | null | undefined, maxLength: number]>) {
  const fields: Record<string, string> = {}
  for (const [field, value, maxLength] of entries) {
    if (!value) continue
    if (value.length > maxLength) fields[field] = `Use ${maxLength} characters or fewer.`
    else if (textMatcher.hasMatch(value)) fields[field] = 'Please remove offensive or profane language.'
  }
  if (Object.keys(fields).length) {
    throw new ApiError('moderation_rejected', 'Please revise the highlighted text.', 400, fields)
  }
}

function rigPhotoUrl(path: string | null): string | undefined {
  return path ? requiredClient().storage.from(RIG_PHOTOS_BUCKET).getPublicUrl(path).data.publicUrl : undefined
}

function rigPhotoPath(value: string | undefined): string | null {
  if (!value) return null

  try {
    const client = requiredClient()
    const marker = '__rig_photo_path__'
    const expected = new URL(client.storage.from(RIG_PHOTOS_BUCKET).getPublicUrl(marker).data.publicUrl)
    const uploaded = new URL(value)
    if (uploaded.origin !== expected.origin || !uploaded.pathname.startsWith(expected.pathname.slice(0, -marker.length))) {
      throw new Error('not a rig photo URL')
    }
    const path = decodeURIComponent(uploaded.pathname.slice(expected.pathname.length - marker.length))
    if (!path) throw new Error('missing rig photo path')
    return path
  } catch {
    throw new ApiError('validation', 'Choose a photo uploaded to this site.', 400)
  }
}

function resultPayload(input: Partial<ResultInput>, create = false): Record<string, unknown> {
  const map: [keyof ResultInput, string][] = [
    ['modelId', 'model_id'], ['quant', 'quant_id'], ['runtimeId', 'runtime_id'], ['runtimeVersion', 'runtime_version'],
    ['runtimeFlags', 'runtime_flags'], ['customRuntimeId', 'custom_runtime_id'], ['revision', 'revision'],
    ['rigId', 'rig_id'], ['componentId', 'component_id'], ['componentQuantity', 'component_quantity'],
    ['decodeTps', 'decode_tps'], ['promptTps', 'prompt_tps'], ['ttftMs', 'ttft_ms'], ['contextLength', 'context_length'],
    ['batchSize', 'batch_size'], ['notes', 'notes'], ['repoUrl', 'repo_url'], ['runDate', 'run_date'],
  ]
  const payload: Record<string, unknown> = {}
  for (const [source, target] of map) {
    if (create || source in input) payload[target] = input[source] ?? null
  }
  if ('repo_url' in payload) payload.repo_url = input.repoUrl?.trim() || null
  if (payload.component_id == null) payload.component_quantity = null
  // A stock run carries no revision, whatever the form sent.
  if (payload.custom_runtime_id == null && 'revision' in payload) payload.revision = null
  return payload
}

async function loadSnapshot(): Promise<Snapshot> {
  const client = requiredClient()
  const { data: sessionData } = await client.auth.getSession()
  const userId = sessionData.session?.user.id ?? null
  const [profiles, rigs, components, results, customRuntimes, confirmations, flags] = await Promise.all([
    rows<ProfileRow[]>(client.from('profiles').select('*')),
    rows<RigRow[]>(client.from('rigs').select('*')),
    rows<ComponentRow[]>(client.from('rig_components').select('*')),
    rows<ResultRow[]>(client.from('results').select('*')),
    optionalRows<CustomRuntimeRow>('custom runtimes', client.from('custom_runtimes').select('*')),
    userId ? optionalRows<ConfirmationRow>('confirmations', client.from('result_confirmations').select('result_id,user_id')) : Promise.resolve([]),
    userId ? optionalRows<FlagRow>('flags', client.from('result_flags').select('result_id,user_id,reason')) : Promise.resolve([]),
  ])
  return { userId, profiles, rigs, components, results, customRuntimes, confirmations, flags }
}

const stringId = (value: number | string) => String(value)
const numberValue = (value: number | string) => Number(value)
const optional = <T,>(value: T | null): T | undefined => value ?? undefined

function publicUser(row: ProfileRow): User {
  return {
    id: row.id,
    handle: row.handle,
    name: optional(row.name),
    avatarUrl: row.avatar_url,
    bio: optional(row.bio),
    createdAt: row.created_at,
  }
}

function summaryLine(components: ComponentRow[]): string {
  const parts: string[] = []
  const cpu = components.find((part) => HARDWARE_BY_ID[part.hardware_id]?.type === 'cpu')
  if (cpu) parts.push(HARDWARE_BY_ID[cpu.hardware_id].name)
  const gpus = components.filter((part) => HARDWARE_BY_ID[part.hardware_id]?.type === 'gpu')
  for (const gpu of gpus) parts.push(`${gpu.quantity}× ${HARDWARE_BY_ID[gpu.hardware_id].name}`)
  if (!gpus.length) {
    const integrated = components.find((part) => HARDWARE_BY_ID[part.hardware_id]?.type === 'igpu')
    if (integrated) parts.push(HARDWARE_BY_ID[integrated.hardware_id].name)
  }
  const memory = components.filter((part) => HARDWARE_BY_ID[part.hardware_id]?.type === 'ram')
  if (memory.length) {
    const total = memory.reduce((sum, part) => sum + part.quantity * Number(HARDWARE_BY_ID[part.hardware_id].specs.capacityGb ?? 0), 0)
    parts.push(`${total} GB ${HARDWARE_BY_ID[memory[0].hardware_id].specs.type ?? ''}`.trim())
  }
  return parts.join(' · ')
}

function view(snapshot: Snapshot) {
  const profileById = new Map(snapshot.profiles.map((row) => [row.id, row]))
  const rigById = new Map(snapshot.rigs.map((row) => [stringId(row.id), row]))
  const componentsByRig = new Map<string, ComponentRow[]>()
  for (const component of snapshot.components) {
    const id = stringId(component.rig_id)
    componentsByRig.set(id, [...(componentsByRig.get(id) ?? []), component])
  }
  const resultRows = snapshot.results

  const customRuntime = (row: CustomRuntimeRow): CustomRuntime => {
    const id = stringId(row.id)
    const mine = resultRows.filter((result) => result.custom_runtime_id != null && stringId(result.custom_runtime_id) === id && !result.hidden)
    const profile = profileById.get(row.owner_id)
    return {
      id,
      ownerId: row.owner_id,
      owner: profile ? publicUser(profile) : undefined,
      runtimeId: row.runtime_id,
      runtime: RUNTIME_BY_ID[row.runtime_id],
      name: row.name,
      repoUrl: row.repo_url,
      summary: row.summary,
      notes: optional(row.notes),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      resultsCount: mine.length,
      rigsCount: new Set(mine.map((result) => stringId(result.rig_id))).size,
      bestTps: mine.length ? Math.max(...mine.map((result) => numberValue(result.decode_tps))) : undefined,
    }
  }
  const customRuntimeById = new Map(snapshot.customRuntimes.map((row) => [stringId(row.id), customRuntime(row)]))

  const rigSummary = (row: RigRow): RigSummary => {
    const id = stringId(row.id)
    const matching = resultRows.filter((result) => stringId(result.rig_id) === id && !result.hidden)
    const owner = profileById.get(row.owner_id)
    return {
      id,
      name: row.name,
      photoUrl: rigPhotoUrl(row.photo_path),
      summary: summaryLine(componentsByRig.get(id) ?? []),
      owner: owner ? publicUser(owner) : undefined,
      components: (componentsByRig.get(id) ?? []).map((component) => ({ hardwareId: component.hardware_id, quantity: component.quantity })),
      resultsCount: matching.length,
      bestTps: matching.length ? Math.max(...matching.map((result) => numberValue(result.decode_tps))) : undefined,
    }
  }

  const rig = (row: RigRow): Rig => {
    const id = stringId(row.id)
    const owner = profileById.get(row.owner_id)
    const componentRows = componentsByRig.get(id) ?? []
    return {
      id,
      ownerId: row.owner_id,
      owner: owner ? publicUser(owner) : undefined,
      name: row.name,
      os: row.os,
      photoUrl: rigPhotoUrl(row.photo_path),
      notes: optional(row.notes),
      components: componentRows.map((component) => ({
        hardwareId: component.hardware_id,
        quantity: component.quantity,
        hardware: HARDWARE_BY_ID[component.hardware_id],
      })),
      summary: summaryLine(componentRows),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  const result = (row: ResultRow): Result => {
    const id = stringId(row.id)
    const submitter = profileById.get(row.submitter_id)
    const resultRig = rigById.get(stringId(row.rig_id))
    const resultFlags = snapshot.flags.filter((flag) => stringId(flag.result_id) === id)
    return {
      id,
      submitterId: row.submitter_id,
      submitter: submitter ? publicUser(submitter) : undefined,
      modelId: row.model_id,
      quant: row.quant_id,
      runtimeId: row.runtime_id,
      runtimeVersion: row.runtime_version,
      runtimeFlags: optional(row.runtime_flags),
      customRuntimeId: row.custom_runtime_id == null ? undefined : stringId(row.custom_runtime_id),
      customRuntime: row.custom_runtime_id == null ? undefined : customRuntimeById.get(stringId(row.custom_runtime_id)),
      revision: optional(row.revision),
      execution: row.custom_runtime_id == null ? 'stock' : 'modified',
      rigId: stringId(row.rig_id),
      rig: resultRig ? rigSummary(resultRig) : undefined,
      componentId: optional(row.component_id),
      componentQuantity: optional(row.component_quantity),
      component: row.component_id ? HARDWARE_BY_ID[row.component_id] : undefined,
      componentHost: row.component_id
        ? hostIn((componentsByRig.get(stringId(row.rig_id)) ?? []).map((part) => ({ hardwareId: part.hardware_id })), row.component_id)
        : undefined,
      decodeTps: numberValue(row.decode_tps),
      promptTps: row.prompt_tps == null ? undefined : numberValue(row.prompt_tps),
      ttftMs: row.ttft_ms == null ? undefined : numberValue(row.ttft_ms),
      contextLength: optional(row.context_length),
      batchSize: optional(row.batch_size),
      notes: optional(row.notes),
      repoUrl: optional(row.repo_url),
      sourcePrUrl: optional(row.source_pr_url),
      runDate: row.run_date,
      verification: {
        status: row.verification_status,
        confirmations: row.confirmations_count,
        confirmedByMe: snapshot.confirmations.some((item) => stringId(item.result_id) === id && item.user_id === snapshot.userId),
      },
      moderation: {
        flags: row.flags_count,
        hidden: row.hidden,
        flaggedByMe: resultFlags.some((item) => item.user_id === snapshot.userId),
        reasons: resultFlags.map((item) => item.reason),
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  return { profileById, rigById, componentsByRig, rigSummary, rig, result, customRuntime, customRuntimeById }
}

function paginate<T>(items: T[], limit = 25, cursor?: string): Page<T> {
  const start = cursor ? Number.parseInt(cursor, 10) || 0 : 0
  const page = items.slice(start, start + limit)
  return { items: page, nextCursor: start + limit < items.length ? String(start + limit) : undefined }
}

const unitKey = (result: Result) => result.componentId ? `${result.componentId}x${result.componentQuantity ?? 1}` : `rig:${result.rigId}`

function bestPerKey(items: Result[], key: (result: Result) => string): Result[] {
  const best = new Map<string, Result>()
  for (const result of items) {
    const current = best.get(key(result))
    if (!current || result.decodeTps > current.decodeTps || (result.decodeTps === current.decodeTps && result.runDate < current.runDate)) {
      best.set(key(result), result)
    }
  }
  return [...best.values()].sort((a, b) => b.decodeTps - a.decodeTps || a.runDate.localeCompare(b.runDate))
}

function unitFor(result: Result): BoardUnit {
  if (!result.componentId) return { kind: 'rig', rig: result.rig! }
  return { kind: 'component', hardware: HARDWARE_BY_ID[result.componentId], quantity: result.componentQuantity ?? 1 }
}

const unitLabel = (unit: BoardUnit) => unit.kind === 'rig' ? unit.rig.name : `${unit.quantity > 1 ? `${unit.quantity}× ` : ''}${unit.hardware.name}`
const unitHref = (unit: BoardUnit) => unit.kind === 'rig' ? `/rigs/${unit.rig.id}` : `/hardware/${unit.hardware.id}`

function boardItems(results: Result[], modelId: string, quant: string, params: Partial<BoardParams>): Result[] {
  const filtered = results.filter((result) => {
    if (result.modelId !== modelId || result.quant !== quant || result.moderation.hidden) return false
    if (params.kind === 'rigs' ? result.componentId : params.kind === 'components' ? !result.componentId : false) return false
    if (params.runtime?.length && !params.runtime.includes(result.runtimeId)) return false
    if (params.verification && result.verification.status !== params.verification) return false
    if (!params.includeModified && result.execution === 'modified') return false
    if (params.vendor) {
      if (result.component?.vendor !== params.vendor && !result.rig?.summary.toLowerCase().includes(params.vendor.toLowerCase())) return false
    }
    if (params.type && result.component && result.component.type !== params.type) return false
    if (params.q) {
      const query = params.q.toLowerCase()
      if (![result.component?.name, result.rig?.name, result.rig?.summary, result.submitter?.handle].some((text) => text?.toLowerCase().includes(query))) return false
    }
    return true
  })
  return bestPerKey(filtered, unitKey)
}

function boardRows(results: Result[], modelId: string, quant: string, params: BoardParams): BoardRow[] {
  return boardItems(results, modelId, quant, params).map((result, index) => ({ rank: index + 1, result, unit: unitFor(result) }))
}

const chartFromRows = (items: BoardRow[]): ChartBar[] => items.slice(0, 10).map((row) => ({
  label: unitLabel(row.unit),
  tps: row.result.decodeTps,
  runtimeId: row.result.runtimeId,
  href: unitHref(row.unit),
}))

function bestChart(items: Result[], includePart = false): ChartBar[] {
  const best = bestPerKey(items, (result) => `${result.modelId}/${result.quant}${includePart ? `/${unitKey(result)}` : ''}`)
  return best.slice(0, 10).map((result) => ({
    label: `${MODEL_BY_ID[result.modelId]?.name ?? result.modelId} ${QUANT_BY_ID[result.quant]?.label ?? result.quant}${includePart ? ` · ${unitLabel(unitFor(result))}` : ''}`,
    tps: result.decodeTps,
    runtimeId: result.runtimeId,
    href: `/results/${result.id}`,
  }))
}

function userStats(snapshot: Snapshot, user: User): UserStats {
  const hydrated = snapshot.results.filter((row) => !row.hidden).map(view(snapshot).result)
  let bestRank: BestRank | undefined
  for (const model of MODELS) {
    for (const quant of model.quants) {
      for (const kind of ['rigs', 'components'] as BoardKind[]) {
        const items = boardItems(hydrated, model.id, quant, { kind })
        const index = items.findIndex((result) => result.submitterId === user.id)
        if (index >= 0 && (!bestRank || index + 1 < bestRank.position)) bestRank = { modelId: model.id, quant, kind, position: index + 1 }
      }
    }
  }
  return {
    results: hydrated.filter((result) => result.submitterId === user.id).length,
    rigs: snapshot.rigs.filter((rig) => rig.owner_id === user.id).length,
    bestRank,
    confirmationsGiven: snapshot.confirmations.filter((item) => item.user_id === user.id).length,
  }
}

async function requireUserId(): Promise<string> {
  const { data, error } = await requiredClient().auth.getUser()
  if (error || !data.user) throw new ApiError('unauthorized', 'Sign in to do that.', 401)
  return data.user.id
}

export const supabaseApi: Api = {
  mode: 'supabase',

  async me() {
    const client = requiredClient()
    const { data, error } = await client.auth.getUser()
    if (error || !data.user) return null
    const snapshot = await loadSnapshot()
    const row = snapshot.profiles.find((profile) => profile.id === data.user.id)
    if (!row) throw new ApiError('profile_missing', 'Your profile has not been created yet.', 409)
    const user = publicUser(row)
    return { ...user, stats: userStats(snapshot, user) }
  },
  signInUrl: () => '#sign-in',
  signOut: signOutSupabase,

  async models() {
    const snapshot = await loadSnapshot()
    return MODELS.map((model) => ({
      ...model,
      resultCounts: Object.fromEntries(model.quants.map((quant) => [quant, snapshot.results.filter((row) => !row.hidden && row.model_id === model.id && row.quant_id === quant).length])),
    }))
  },
  async model(id) {
    if (!MODEL_BY_ID[id]) throw new ApiError('not_found', 'No such model.', 404)
    return (await supabaseApi.models()).find((model) => model.id === id)!
  },
  async modelSummaries() {
    const snapshot = await loadSnapshot()
    const hydrated = snapshot.results.map(view(snapshot).result)
    const models = await supabaseApi.models()
    return models.map((model): ModelSummary => {
      const quant = [...model.quants].sort((a, b) => (model.resultCounts?.[b] ?? 0) - (model.resultCounts?.[a] ?? 0))[0]
      // Most results name a part rather than a whole rig, so a quant's rigs board can be empty while its components
      // board is full: the tile shows whichever has rows, rigs first.
      const rigs = boardRows(hydrated, model.id, quant, { kind: 'rigs' })
      const components = rigs.length ? [] : boardRows(hydrated, model.id, quant, { kind: 'components' })
      const [kind, items]: [BoardKind, BoardRow[]] = rigs.length || !components.length ? ['rigs', rigs] : ['components', components]
      const best = model.quants
        .flatMap((q) => [boardRows(hydrated, model.id, q, { kind: 'rigs' })[0], boardRows(hydrated, model.id, q, { kind: 'components' })[0]])
        .filter(Boolean)
        .sort((a, b) => b.result.decodeTps - a.result.decodeTps)[0]
      return { model, board: { modelId: model.id, quant, kind, total: items.length }, top: items.slice(0, 3), best }
    })
  },
  async runtimes() { return RUNTIMES },
  async quants() { return QUANTS },
  async hardware(params = {}) {
    const snapshot = await loadSnapshot()
    let items = VISIBLE_HARDWARE.map((hardware): HardwareItem => ({
      ...hardware,
      resultsCount: snapshot.results.filter((result) => !result.hidden && result.component_id === hardware.id).length,
      rigsCount: new Set(snapshot.components.filter((part) => part.hardware_id === hardware.id).map((part) => stringId(part.rig_id))).size,
    }))
    if (params.type) items = items.filter((item) => item.type === params.type)
    if (params.vendor) items = items.filter((item) => item.vendor === params.vendor)
    if (params.q) {
      const query = params.q.toLowerCase()
      items = items.filter((item) => `${item.vendor} ${item.name} ${item.series ?? ''}`.toLowerCase().includes(query))
    }
    return paginate(items, params.limit ?? 100, params.cursor)
  },
  async hardwareItem(id) {
    const hardware = (await supabaseApi.hardware({ limit: 1000 })).items.find((item) => item.id === id)
    if (!hardware) throw new ApiError('not_found', 'No such hardware.', 404)
    const snapshot = await loadSnapshot()
    const data = view(snapshot)
    const results = snapshot.results.map(data.result).filter((result) => !result.moderation.hidden && result.componentId === id).sort((a, b) => b.decodeTps - a.decodeTps)
    const rigIds = new Set(snapshot.components.filter((part) => part.hardware_id === id).map((part) => stringId(part.rig_id)))
    const detail: HardwareDetail = {
      ...hardware,
      chart: hardwareChart(results),
      rigs: snapshot.rigs.filter((rig) => rigIds.has(stringId(rig.id))).map(data.rigSummary),
      results,
    }
    return detail
  },

  async board(modelId, quant, params) {
    if (!MODEL_BY_ID[modelId] || !MODEL_BY_ID[modelId].quants.includes(quant)) throw new ApiError('not_found', 'No such board.', 404)
    const snapshot = await loadSnapshot()
    const hydrated = snapshot.results.map(view(snapshot).result)
    const all = boardRows(hydrated, modelId, quant, params)
    const page = paginate(all, params.limit ?? 25, params.cursor)
    const response: BoardResponse = {
      board: { modelId, quant, kind: params.kind, total: all.length },
      items: page.items,
      nextCursor: page.nextCursor,
      chart: chartFromRows(all),
    }
    return response
  },

  async rigs(params = {}) {
    const snapshot = await loadSnapshot()
    const data = view(snapshot)
    let rigs = snapshot.rigs
    if (params.owner) rigs = rigs.filter((rig) => data.profileById.get(rig.owner_id)?.handle === params.owner)
    if (params.hardware) {
      const ids = new Set(snapshot.components.filter((part) => part.hardware_id === params.hardware).map((part) => stringId(part.rig_id)))
      rigs = rigs.filter((rig) => ids.has(stringId(rig.id)))
    }
    let items = rigs.map(data.rigSummary)
    if (params.sort === 'results') items.sort((a, b) => b.resultsCount - a.resultsCount)
    else if (params.sort === 'tps') items.sort((a, b) => (b.bestTps ?? 0) - (a.bestTps ?? 0))
    else items.sort((a, b) => Number(b.id) - Number(a.id))
    return paginate(items, params.limit ?? 24, params.cursor)
  },
  async rig(id) {
    const snapshot = await loadSnapshot()
    const data = view(snapshot)
    const row = data.rigById.get(id)
    if (!row) throw new ApiError('not_found', 'No such rig.', 404)
    const results = snapshot.results.map(data.result).filter((result) => result.rigId === id).sort((a, b) => b.runDate.localeCompare(a.runDate))
    const detail: RigDetail = { ...data.rig(row), results, chart: bestChart(results.filter((result) => !result.moderation.hidden), true) }
    return detail
  },
  async createRig(input) {
    await requireUserId()
    if (!input.name.trim() || !input.components.length) throw new ApiError('validation', 'Add a name and at least one component.', 400)
    moderateText([['name', input.name, 120], ['os', input.os, 120], ['notes', input.notes, 5000]])
    const id = await rows<number | string>(requiredClient().rpc('create_rig', {
      p_name: input.name.trim(),
      p_os: input.os.trim(),
      p_photo_path: rigPhotoPath(input.photoUrl),
      p_notes: input.notes ?? null,
      p_components: input.components.map((part) => ({ hardware_id: part.hardwareId, quantity: part.quantity })),
    }))
    return supabaseApi.rig(stringId(id))
  },
  async updateRig(id, input) {
    await requireUserId()
    const current = await supabaseApi.rig(id)
    const merged = {
      name: input.name ?? current.name,
      os: input.os ?? current.os,
      photoUrl: 'photoUrl' in input ? input.photoUrl : current.photoUrl,
      notes: 'notes' in input ? input.notes : current.notes,
      components: input.components ?? current.components.map((part) => ({ hardwareId: part.hardwareId, quantity: part.quantity })),
    }
    if (!merged.name.trim() || !merged.components.length) throw new ApiError('validation', 'Add a name and at least one component.', 400)
    moderateText([['name', merged.name, 120], ['os', merged.os, 120], ['notes', merged.notes, 5000]])
    await rows<number | string>(requiredClient().rpc('update_rig', {
      p_rig_id: id,
      p_name: merged.name.trim(),
      p_os: merged.os.trim(),
      p_photo_path: rigPhotoPath(merged.photoUrl),
      p_notes: merged.notes ?? null,
      p_components: merged.components.map((part) => ({ hardware_id: part.hardwareId, quantity: part.quantity })),
    }))
    return supabaseApi.rig(id)
  },
  async deleteRig(id) {
    await requireUserId()
    await rows(requiredClient().from('rigs').delete().eq('id', id).select('id'))
  },

  async runtimeSummaries() {
    const snapshot = await loadSnapshot()
    const visible = snapshot.results.filter((row) => !row.hidden)
    return RUNTIMES.map((runtime) => {
      const mine = visible.filter((row) => row.runtime_id === runtime.id)
      return {
        ...runtime,
        resultsCount: mine.length,
        buildsCount: snapshot.customRuntimes.filter((row) => row.runtime_id === runtime.id).length,
        bestTps: mine.length ? Math.max(...mine.map((row) => numberValue(row.decode_tps))) : undefined,
      }
    })
  },
  async customRuntimes(params = {}) {
    const snapshot = await loadSnapshot()
    const data = view(snapshot)
    let items = snapshot.customRuntimes.map(data.customRuntime)
    if (params.runtime) items = items.filter((build) => build.runtimeId === params.runtime)
    if (params.owner) items = items.filter((build) => build.owner?.handle === params.owner)
    // The submitter's own first: the picker shows them under "Yours" without a second query.
    const mine = snapshot.userId
    items.sort((a, b) =>
      Number(b.ownerId === mine) - Number(a.ownerId === mine) || b.createdAt.localeCompare(a.createdAt))
    return { items }
  },
  async customRuntime(id) {
    const snapshot = await loadSnapshot()
    const data = view(snapshot)
    const build = data.customRuntimeById.get(id)
    if (!build) throw new ApiError('not_found', 'No such build.', 404)
    const results = snapshot.results
      .map(data.result)
      .filter((result) => result.customRuntimeId === id && !result.moderation.hidden)
      .sort((a, b) => b.decodeTps - a.decodeTps)
    return { ...build, results, chart: bestChart(results, true) }
  },
  async createCustomRuntime(input) {
    const ownerId = await requireUserId()
    moderateText([['name', input.name, 120], ['summary', input.summary, BUILD_SUMMARY_MAX], ['notes', input.notes, 5000]])
    const created = await rows<CustomRuntimeRow[]>(requiredClient().from('custom_runtimes').insert({
      owner_id: ownerId,
      runtime_id: input.runtimeId,
      name: input.name.trim(),
      repo_url: input.repoUrl.trim(),
      summary: input.summary.trim(),
      notes: input.notes?.trim() || null,
    }).select('*'))
    return supabaseApi.customRuntime(stringId(created[0].id))
  },
  async updateCustomRuntime(id, input) {
    await requireUserId()
    moderateText([['name', input.name, 120], ['summary', input.summary, BUILD_SUMMARY_MAX], ['notes', input.notes, 5000]])
    const payload: Record<string, unknown> = {}
    if ('runtimeId' in input) payload.runtime_id = input.runtimeId
    if ('name' in input) payload.name = input.name?.trim()
    if ('repoUrl' in input) payload.repo_url = input.repoUrl?.trim()
    if ('summary' in input) payload.summary = input.summary?.trim()
    if ('notes' in input) payload.notes = input.notes?.trim() || null
    const updated = await rows<CustomRuntimeRow[]>(requiredClient().from('custom_runtimes').update(payload).eq('id', id).select('*'))
    if (!updated.length) throw new ApiError('not_found', 'No such build, or it is not yours.', 404)
    return supabaseApi.customRuntime(id)
  },

  async results(params = {}) {
    const snapshot = await loadSnapshot()
    const data = view(snapshot)
    let items = snapshot.results.map(data.result)
    if (params.rig) items = items.filter((result) => result.rigId === params.rig)
    if (params.hardware) items = items.filter((result) => result.componentId === params.hardware)
    if (params.model) items = items.filter((result) => result.modelId === params.model)
    if (params.quant) items = items.filter((result) => result.quant === params.quant)
    if (params.runtime) items = items.filter((result) => result.runtimeId === params.runtime)
    if (params.user) items = items.filter((result) => result.submitter?.handle === params.user)
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return paginate(items, params.limit ?? 25, params.cursor)
  },
  async result(id) {
    const snapshot = await loadSnapshot()
    const data = view(snapshot)
    const row = snapshot.results.find((result) => stringId(result.id) === id)
    if (!row) throw new ApiError('not_found', 'No such result.', 404)
    const result = data.result(row)
    const kind: BoardKind = result.componentId ? 'components' : 'rigs'
    const ranked = boardItems(snapshot.results.map(data.result), result.modelId, result.quant, { kind, includeModified: result.execution === 'modified' })
    const position = ranked.findIndex((candidate) => unitKey(candidate) === unitKey(result))
    const detail: ResultDetail = { ...result, rank: position >= 0 ? { kind, position: position + 1, boardSize: ranked.length } : undefined }
    return detail
  },
  async createResult(input) {
    const submitterId = await requireUserId()
    moderateText([['runtimeVersion', input.runtimeVersion, 80], ['runtimeFlags', input.runtimeFlags, RUNTIME_FLAGS_MAX], ['revision', input.revision, REVISION_MAX], ['notes', input.notes, 5000]])
    const created = await rows<ResultRow[]>(requiredClient().from('results').insert({
      ...resultPayload(input, true),
      submitter_id: submitterId,
    }).select('*'))
    return supabaseApi.result(stringId(created[0].id))
  },
  async updateResult(id, input) {
    await requireUserId()
    moderateText([['runtimeVersion', input.runtimeVersion, 80], ['runtimeFlags', input.runtimeFlags, RUNTIME_FLAGS_MAX], ['revision', input.revision, REVISION_MAX], ['notes', input.notes, 5000]])
    const updated = await rows<ResultRow[]>(requiredClient().from('results').update(resultPayload(input)).eq('id', id).select('*'))
    if (!updated.length) throw new ApiError('not_found', 'No such result.', 404)
    return supabaseApi.result(id)
  },
  async deleteResult(id) {
    await requireUserId()
    await rows(requiredClient().from('results').delete().eq('id', id).select('id'))
  },
  async confirmResult(id) {
    const userId = await requireUserId()
    const client = requiredClient()
    const existing = await rows<ConfirmationRow[]>(client.from('result_confirmations').select('result_id,user_id').eq('result_id', id).eq('user_id', userId))
    if (existing.length) await rows(client.from('result_confirmations').delete().eq('result_id', id).eq('user_id', userId).select('result_id'))
    else await rows(client.from('result_confirmations').insert({ result_id: id, user_id: userId }).select('result_id'))
    const result = await supabaseApi.result(id)
    return { ...result.verification, confirmedByMe: !existing.length }
  },
  async flagResult(id, reason, note) {
    const userId = await requireUserId()
    const client = requiredClient()
    const existing = await rows<FlagRow[]>(client.from('result_flags').select('result_id,user_id,reason').eq('result_id', id).eq('user_id', userId))
    if (existing.length) await rows(client.from('result_flags').delete().eq('result_id', id).eq('user_id', userId).select('result_id'))
    else await rows(client.from('result_flags').insert({ result_id: id, user_id: userId, reason, note: note ?? null }).select('result_id'))
    const result = await supabaseApi.result(id)
    const moderation: Moderation = { ...result.moderation, flaggedByMe: !existing.length }
    return moderation
  },

  async user(handle) {
    const snapshot = await loadSnapshot()
    const row = snapshot.profiles.find((profile) => profile.handle === handle)
    if (!row) throw new ApiError('not_found', 'No such user.', 404)
    const user = publicUser(row)
    return { ...user, stats: userStats(snapshot, user) }
  },
  async userRigs(handle) { return supabaseApi.rigs({ owner: handle, limit: 100 }) },
  async userResults(handle) { return supabaseApi.results({ user: handle, limit: 100 }) },

  async home() {
    const snapshot = await loadSnapshot()
    const data = view(snapshot)
    const response: HomeResponse = {
      stats: {
        results: snapshot.results.filter((result) => !result.hidden).length,
        rigs: snapshot.rigs.length,
        hardware: VISIBLE_HARDWARE.length,
        members: snapshot.profiles.length,
      },
      topRigs: snapshot.rigs.map(data.rigSummary).sort((a, b) => (b.bestTps ?? 0) - (a.bestTps ?? 0)).slice(0, 6),
    }
    return response
  },
  async topResults(params = {}) {
    const snapshot = await loadSnapshot()
    const data = view(snapshot)
    let results = snapshot.results.map(data.result).filter((result) => !result.moderation.hidden && result.execution !== 'modified')
    if (params.model) results = results.filter((result) => result.modelId === params.model)
    if (params.quant) results = results.filter((result) => result.quant === params.quant)
    const best = bestPerKey(results, (result) => `${unitKey(result)}|${result.modelId}|${result.quant}`)
    const items = best.slice(0, params.limit ?? 10).map((result, index): BoardRow => ({ rank: index + 1, result, unit: unitFor(result) }))
    const response: TopResultsResponse = {
      items,
      chart: items.map((row) => ({
        label: `${unitLabel(row.unit)} · ${MODEL_BY_ID[row.result.modelId]?.name ?? row.result.modelId} ${QUANT_BY_ID[row.result.quant]?.label ?? row.result.quant}`,
        tps: row.result.decodeTps,
        runtimeId: row.result.runtimeId,
        href: `/results/${row.result.id}`,
      })),
      total: best.length,
    }
    return response
  },
  async upload(file) {
    const userId = await requireUserId()
    if (!file.type.startsWith('image/')) throw new ApiError('validation', 'Choose an image file.', 400)
    if (file.size > 10 * 1024 * 1024) throw new ApiError('validation', 'Images must be 10 MB or smaller.', 400)
    const safeName = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(-100) || 'photo'
    const path = `${userId}/${crypto.randomUUID()}-${safeName}`
    const client = requiredClient()
    const { error } = await client.storage.from(RIG_PHOTOS_BUCKET).upload(path, file, { contentType: file.type, upsert: false })
    if (error) throw apiError(error)
    return { url: client.storage.from(RIG_PHOTOS_BUCKET).getPublicUrl(path).data.publicUrl }
  },
}
