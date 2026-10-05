import { createHash, randomBytes } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { ApiError } from '../lib/api/types.js'
import { HARDWARE_BY_ID, MODEL_BY_ID, MODELS, QUANT_BY_ID, QUANTS, RUNTIME_BY_ID, RUNTIMES, VISIBLE_HARDWARE } from '../catalog/index.js'
import { fromDatabase, keySchema, matchRoute, moderateBody, openApiDocument, toDatabase, validate } from './contract.js'

export type Backend = {
  rpc(name: string, params: Record<string, unknown>): Promise<{ data: unknown; error: { code?: string; message: string } | null }>
  user(token: string): Promise<string | null>
  signedUpload(path: string): Promise<string>
  photoUrl(path: string): string
}
export function configuredBackend(): Backend | null {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL
  const secret = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !secret) return null
  const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
  return {
    rpc: async (name, params) => client.rpc(name, params),
    user: async (token) => {
      const { data, error } = await client.auth.getUser(token)
      return error ? null : data.user?.id ?? null
    },
    signedUpload: async (path) => {
      const { data, error } = await client.storage.from('rig-photos').createSignedUploadUrl(path, { upsert: false })
      if (error || !data) throw new ApiError('upload_unavailable', 'Could not issue an upload URL. Retry with the same Idempotency-Key.', 503)
      return data.signedUrl
    },
    photoUrl: (path) => client.storage.from('rig-photos').getPublicUrl(path).data.publicUrl,
  }
}
export const hashKey = (token: string) => createHash('sha256').update(token).digest('hex')
const headers = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' }
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { ...headers, ...(status === 429 ? { 'retry-after': '60' } : {}) } })
const fail = (code: string, message: string, status: number): never => { throw new ApiError(code, message, status) }
function bearer(request: Request): string {
  const match = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)
  if (!match) return fail('unauthorized', 'Use Authorization: Bearer <key>.', 401)
  return match[1]
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  const length = request.headers.get('content-length')
  if (length && Number(length) > 1024 * 1024) fail('too_large', 'JSON requests must be 1 MiB or smaller. Upload images using signed URLs.', 413)
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) fail('content_type', 'Use Content-Type: application/json.', 415)
  const reader = request.body?.getReader()
  if (!reader) return fail('validation', 'Provide a JSON object.', 400)
  const chunks: Uint8Array[] = []; let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > 1024 * 1024) { await reader.cancel(); fail('too_large', 'JSON requests must be 1 MiB or smaller.', 413) }
    chunks.push(value)
  }
  try {
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('validation', 'Provide a JSON object.', 400)
    return body as Record<string, unknown>
  } catch (error) {
    if (error instanceof ApiError) throw error
    return fail('validation', 'Invalid JSON.', 400)
  }
}
async function rpc(backend: Backend, name: string, params: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await backend.rpc(name, params)
  if (error) {
    const status = error.code === 'P0002' ? 404 : error.code?.startsWith('23') || error.code?.startsWith('22') ? 400 : 503
    throw new ApiError(status === 503 ? 'unavailable' : 'validation', status === 503 ? 'The API is unavailable. Please try again later.' : error.message, status)
  }
  return data
}
function queryParams(url: URL, action: string): Record<string, string> {
  const allowed = action.endsWith('.list') ? ['owner', 'q', 'cursor', 'limit', 'rig', 'model', 'runtime', 'hardware'] : action === 'rigs.delete' ? ['cascade'] : []
  const result: Record<string, string> = {}
  for (const [key, value] of url.searchParams) {
    // Vercel's internal rewrite carries the route here; it never enters the DB.
    if (key === 'route') continue
    if (!allowed.includes(key) || key in result || value.length > 200) fail('validation', `Unsupported or repeated query parameter: ${key}.`, 400)
    if (['cursor', 'rig'].includes(key) && !/^[1-9][0-9]{0,17}$/.test(value)) fail('validation', `${key} must be a numeric ID.`, 400)
    if (key === 'limit' && (!/^[0-9]+$/.test(value) || Number(value) < 1 || Number(value) > 100)) fail('validation', 'limit must be 1–100.', 400)
    if (key === 'owner' && value !== 'me' && !/^[a-f0-9-]{36}$/i.test(value)) fail('validation', 'owner must be me or a user UUID from /users/{handle}.', 400)
    if (key === 'cascade' && !['true', 'false'].includes(value)) fail('validation', 'cascade must be true or false.', 400)
    result[key] = value
  }
  return result
}
function normalizeComponents(body: Record<string, unknown>) {
  if (!Array.isArray(body.components)) return
  const parts = body.components as { hardwareId: string; quantity: number }[]
  if (new Set(parts.map((part) => part.hardwareId)).size !== parts.length) fail('validation', 'List each hardware ID once, with its quantity.', 400)
  for (const part of parts) {
    if (!HARDWARE_BY_ID[part.hardwareId]) fail('validation', `Unknown hardware: ${part.hardwareId}. Read /catalog for available IDs.`, 400)
    if (['igpu', 'npu'].includes(HARDWARE_BY_ID[part.hardwareId].type)) {
      const hosts = parts.filter((candidate) => HARDWARE_BY_ID[candidate.hardwareId]?.integrated?.includes(part.hardwareId))
      if (!hosts.length) fail('validation', `Include the host CPU for ${part.hardwareId}.`, 400)
      part.quantity = hosts.reduce((sum, host) => sum + host.quantity, 0)
    }
  }
}
// Reject unknown catalog IDs with a useful message instead of a raw foreign-key error.
// The database constraints remain the authority; PATCH bodies are checked field by field.
function checkCatalog(body: Record<string, unknown>) {
  if (Array.isArray(body.items)) return body.items.forEach((item) => checkCatalog(item as Record<string, unknown>))
  const unknown = (what: string, id: unknown) => fail('validation', `Unknown ${what}: ${id}. Read /catalog for available IDs.`, 400)
  if (typeof body.modelId === 'string' && !MODEL_BY_ID[body.modelId]) unknown('model', body.modelId)
  if (typeof body.quant === 'string' && !QUANT_BY_ID[body.quant]) unknown('quant', body.quant)
  if (typeof body.runtimeId === 'string' && !RUNTIME_BY_ID[body.runtimeId]) unknown('runtime', body.runtimeId)
  if (typeof body.componentId === 'string' && !HARDWARE_BY_ID[body.componentId]) unknown('hardware', body.componentId)
  if (typeof body.modelId === 'string' && typeof body.quant === 'string' && !MODEL_BY_ID[body.modelId].quants.includes(body.quant)) {
    fail('validation', `${body.modelId} does not support quant ${body.quant}. Supported: ${MODEL_BY_ID[body.modelId].quants.join(', ')}.`, 400)
  }
}

export function createHandler(getBackend: () => Backend | null = configuredBackend) {
  return async function handle(request: Request): Promise<Response> {
    try {
      const url = new URL(request.url)
      if (url.pathname === '/api/openapi.json' && request.method === 'GET') return json(openApiDocument())
      if (url.pathname === '/api/keys' && url.searchParams.has('route')) url.pathname += '/' + url.searchParams.get('route')
      const isKeys = url.pathname === '/api/keys' || /^\/api\/keys\/[a-f0-9-]{36}$/.test(url.pathname) || url.pathname === '/api/keys/activity'
      if (!isKeys && !url.pathname.startsWith('/api/v1/')) return json({ error: { code: 'not_found', message: 'Unknown API route.' } }, 404)
      let path = url.pathname.slice('/api/v1'.length)
      if (path === '/handler') path = '/' + (url.searchParams.get('route') ?? '')
      const match = isKeys ? null : matchRoute(request.method, path)
      if (!isKeys && !match) return json({ error: { code: 'not_found', message: 'Unknown method or route. Read /docs/agents.md.' } }, 404)
      if (match?.route.action === 'catalog') return json({ hardware: VISIBLE_HARDWARE, models: MODELS, quants: QUANTS, runtimes: RUNTIMES })
      const token = bearer(request)
      const backend = getBackend()
      if (!backend) return fail('not_configured', 'The API is not configured yet.', 503)
      if (isKeys) {
        // A personal key cannot create more keys, revoke keys, or read key settings.
        if (token.startsWith('ii_')) return fail('session_required', 'Sign in to manage API keys.', 401)
        const user = await backend.user(token)
        if (!user) return fail('unauthorized', 'Sign in to manage API keys.', 401)
        if (url.pathname === '/api/keys' && request.method === 'GET') return json(fromDatabase(await rpc(backend, 'manage_agent_keys', { p_user_id: user, p_action: 'list' })))
        if (url.pathname === '/api/keys/activity' && request.method === 'GET') return json(fromDatabase(await rpc(backend, 'manage_agent_keys', { p_user_id: user, p_action: 'activity' })))
        if (url.pathname === '/api/keys' && request.method === 'POST') {
          const body = await readBody(request); validate(keySchema, body)
          if (body.expiresAt && Date.parse(String(body.expiresAt)) <= Date.now()) fail('validation', 'Expiry must be in the future.', 400)
          const key = 'ii_' + randomBytes(32).toString('base64url')
          const data = await rpc(backend, 'manage_agent_keys', { p_user_id: user, p_action: 'create', p_data: { ...toDatabase(body) as object, token_hash: hashKey(key), prefix: key.slice(0, 11) } })
          return json({ ...fromDatabase(data) as object, key }, 201)
        }
        const id = url.pathname.split('/')[3]
        if (id && /^[a-f0-9-]{36}$/.test(id) && request.method === 'DELETE') return json(await rpc(backend, 'manage_agent_keys', { p_user_id: user, p_action: 'revoke', p_data: { id } }))
        return fail('not_found', 'Unknown key management route.', 404)
      }
      if (!/^ii_[A-Za-z0-9_-]{43}$/.test(token)) return fail('unauthorized', 'Use a personal API key created at /settings/api-keys.', 401)
      const { route, id, handle } = match!
      const params: Record<string, unknown> = { query: queryParams(url, route.action), ...(id ? { id } : {}), ...(handle ? { handle } : {}) }
      const requestKey = request.headers.get('idempotency-key')
      if (route.method !== 'GET' && (!requestKey || !/^[\x21-\x7e]{1,128}$/.test(requestKey))) fail('idempotency_required', 'Provide an Idempotency-Key of 1–128 printable non-space ASCII characters.', 400)
      if (route.version) {
        const version = request.headers.get('if-match')
        if (!version) fail('version_required', 'Read the record, then supply If-Match: "<updatedAt>".', 428)
        const timestamp = version!.replace(/^"|"$/g, '')
        if (!/^\d{4}-\d{2}-\d{2}T/.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) fail('validation', 'If-Match must contain the updatedAt timestamp.', 400)
        params.expected_updated_at = timestamp
      }
      if (route.schema) {
        const body = await readBody(request)
        validate(route.schema, body); moderateBody(body); normalizeComponents(body); checkCatalog(body)
        params.body = toDatabase(body)
      }
      const response = await rpc(backend, 'agent_request', { p_token_hash: hashKey(token), p_action: route.action, p_params: params, p_request_key: requestKey }) as { status: number; body: unknown }
      const body = fromDatabase(response.body) as Record<string, unknown>
      if (response.status < 300 && route.action.startsWith('uploads.')) {
        const photoPath = String(body.photoPath)
        body.url = backend.photoUrl(photoPath)
        if (route.action === 'uploads.prepare') {
          body.uploadUrl = await backend.signedUpload(photoPath)
          body.method = 'PUT'; body.expiresInSeconds = 7200
        }
      }
      const result = json(body, response.status)
      if (typeof body.updatedAt === 'string') result.headers.set('etag', JSON.stringify(body.updatedAt))
      return result
    } catch (error) {
      if (error instanceof ApiError) return json({ error: { code: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) } }, error.status)
      // Never log request headers, bodies, API keys, or upstream error objects.
      return json({ error: { code: 'internal_error', message: 'The operation failed. Retry with the same Idempotency-Key.' } }, 500)
    }
  }
}
