import { ApiError } from '../lib/api/types.js'
import { moderateText } from '../lib/api/moderation.js'
import { isEvidenceUrl } from '../lib/evidence.js'

export type Schema = {
  type?: string | string[]; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean
  items?: Schema; minItems?: number; maxItems?: number; minLength?: number; maxLength?: number
  minimum?: number; maximum?: number; exclusiveMinimum?: number; pattern?: string; enum?: unknown[]; format?: string
  description?: string
}
const text = (maxLength: number, minLength = 0): Schema => ({ type: 'string', minLength, maxLength })
const nullable = (schema: Schema): Schema => ({ ...schema, type: [schema.type as string, 'null'] })
const id: Schema = { type: 'string', pattern: '^[1-9][0-9]{0,17}$', description: 'Database ID, as a string.' }
const slug: Schema = { ...text(120, 1), pattern: '^[a-zA-Z0-9_.-]+$' }
const positive: Schema = { type: 'number', exclusiveMinimum: 0, maximum: 1e12 }
const integer: Schema = { type: 'integer', minimum: 1, maximum: 2147483647 }
const https: Schema = { ...text(2048, 1), format: 'https-url' }
const object = (properties: Record<string, Schema>, required: string[] = []): Schema => ({ type: 'object', properties, required, additionalProperties: false })
export const rigSchema = object({
  name: text(120, 1), os: text(120), notes: nullable(text(5000)), photoPath: nullable(text(250, 1)),
  components: { type: 'array', minItems: 1, maxItems: 100, items: object({ hardwareId: slug, quantity: { ...integer, maximum: 32767 } }, ['hardwareId', 'quantity']) },
}, ['name', 'components'])
export const runtimeSchema = object({ runtimeId: slug, name: text(120, 1), repoUrl: { ...text(2048, 1), format: 'http-url' }, summary: text(280, 1), notes: nullable(text(5000)) }, ['runtimeId', 'name', 'repoUrl', 'summary'])
export const resultSchema = object({
  rigId: id, modelId: slug, quant: slug, runtimeId: slug, runtimeVersion: text(80, 1),
  runtimeFlags: nullable(text(200)), customRuntimeId: nullable(id), revision: nullable(text(80)),
  componentId: nullable(slug), componentQuantity: nullable({ ...integer, maximum: 32767 }),
  decodeTps: positive, promptTps: nullable(positive), ttftMs: nullable(positive),
  contextLength: nullable(integer), batchSize: nullable(integer), notes: nullable(text(5000)),
  repoUrl: nullable(https), runDate: { type: 'string', format: 'date' },
}, ['rigId', 'modelId', 'quant', 'runtimeId', 'runtimeVersion', 'decodeTps', 'runDate'])
const flagSchema = object({ reason: { type: 'string', enum: ['implausible', 'wrong_hardware', 'duplicate', 'spam', 'other'] }, note: nullable(text(5000)) }, ['reason'])
export const keySchema = object({
  name: text(80, 1), scopes: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', enum: ['read', 'write', 'community'] } },
  expiresAt: nullable({ type: 'string', format: 'date-time' }),
}, ['name', 'scopes'])
export type Route = { method: string; path: string; action: string; description: string; schema?: Schema; scope: 'read' | 'write' | 'community' | 'public'; version?: boolean }
const resource = (path: string, action: string, schema: Schema): Route[] => [
  { method: 'GET', path, action: `${action}.list`, description: `List ${path.slice(1)}. Filter by owner=me, q, or resource-specific IDs.`, scope: 'read' },
  { method: 'GET', path: `${path}/{id}`, action: `${action}.get`, description: 'Read one record and its current updatedAt version.', scope: 'read' },
  { method: 'POST', path, action: `${action}.create`, description: 'Create a record owned by the authenticated user.', scope: 'write', schema },
  { method: 'PATCH', path: `${path}/{id}`, action: `${action}.update`, description: 'Update your record. Requires If-Match with its updatedAt value.', scope: 'write', schema: { ...schema, required: [] }, version: true },
  { method: 'DELETE', path: `${path}/{id}`, action: `${action}.delete`, description: 'Delete your record. Requires If-Match. Rig deletion with results also requires cascade=true.', scope: 'write', version: true },
]
export const routes: Route[] = [
  { method: 'GET', path: '/catalog', action: 'catalog', description: 'Hardware, models with supported quant IDs, quantizations, and base runtimes. Public; no key required.', scope: 'public' },
  { method: 'GET', path: '/me', action: 'me', description: 'Your profile, key ID, and granted permissions.', scope: 'read' },
  { method: 'GET', path: '/users/{handle}', action: 'users.get', description: 'Read a public profile.', scope: 'read' },
  ...resource('/rigs', 'rigs', rigSchema),
  ...resource('/custom-runtimes', 'custom_runtimes', runtimeSchema),
  // Put the static batch route before /results/{id}.
  { method: 'POST', path: '/results/batch', action: 'results.batch', description: 'Create up to 100 results atomically. A failure rolls back the entire batch.', scope: 'write', schema: object({ items: { type: 'array', minItems: 1, maxItems: 100, items: resultSchema } }, ['items']) },
  ...resource('/results', 'results', resultSchema),
  { method: 'PUT', path: '/results/{id}/confirmation', action: 'confirmations.set', description: 'Confirm another user’s result. Repeating this never removes a confirmation.', scope: 'community' },
  { method: 'DELETE', path: '/results/{id}/confirmation', action: 'confirmations.delete', description: 'Remove your confirmation.', scope: 'community' },
  { method: 'PUT', path: '/results/{id}/flag', action: 'flags.set', description: 'Set or replace your flag on another user’s result.', scope: 'community', schema: flagSchema },
  { method: 'DELETE', path: '/results/{id}/flag', action: 'flags.delete', description: 'Remove your flag.', scope: 'community' },
  { method: 'POST', path: '/uploads', action: 'uploads.prepare', description: 'Reserve a rig photo and obtain a signed upload URL. PUT the image bytes there, then complete the upload.', scope: 'write', schema: object({ contentType: { type: 'string', enum: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] }, size: { type: 'integer', minimum: 1, maximum: 10485760 } }, ['contentType', 'size']) },
  { method: 'POST', path: '/uploads/complete', action: 'uploads.complete', description: 'Verify an uploaded photo and return its photoPath for a rig.', scope: 'write', schema: object({ photoPath: text(250, 1) }, ['photoPath']) },
]

export function matchRoute(method: string, path: string): { route: Route; id?: string; handle?: string } | null {
  for (const route of routes) {
    if (route.method !== method) continue
    const pattern = '^' + route.path.replace('{id}', '([1-9][0-9]{0,17})').replace('{handle}', '([a-zA-Z0-9-]{1,39})') + '$'
    const match = path.match(new RegExp(pattern))
    if (match) return { route, ...(route.path.includes('{handle}') ? { handle: match[1].toLowerCase() } : { id: match[1] }) }
  }
  return null
}

export function validate(schema: Schema, value: unknown, field = 'body'): void {
  const fail = (message: string): never => { throw new ApiError('validation', 'Invalid request.', 400, { [field]: message }) }
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  const kind = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value
  if (!types.includes(kind) && !(types.includes('integer') && typeof value === 'number' && Number.isInteger(value))) fail(`Expected ${types.join(' or ')}.`)
  if (schema.enum && !schema.enum.includes(value)) fail(`Choose one of: ${schema.enum.join(', ')}.`)
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.trim().length < schema.minLength) fail('Cannot be empty.')
    if (schema.maxLength !== undefined && value.length > schema.maxLength) fail(`Maximum length is ${schema.maxLength}.`)
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) fail('Invalid format.')
    if (schema.format === 'http-url' && !isEvidenceUrl(value.replace(/^http:/i, 'https:'))) fail('Use an absolute HTTP or HTTPS URL without credentials.')
    if (schema.format === 'https-url' && !isEvidenceUrl(value)) fail('Use an absolute HTTPS URL without credentials.')
    if (schema.format === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) fail('Use a valid YYYY-MM-DD date.')
    if (schema.format === 'date-time' && (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value)))) fail('Use an ISO timestamp.')
  }
  if (typeof value === 'number' && (!Number.isFinite(value) || (schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum) || (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum))) fail('Number is outside the allowed range.')
  if (Array.isArray(value)) {
    if ((schema.minItems !== undefined && value.length < schema.minItems) || (schema.maxItems !== undefined && value.length > schema.maxItems)) fail(`Provide ${schema.minItems ?? 0}–${schema.maxItems ?? 'any'} items.`)
    value.forEach((item, index) => validate(schema.items!, item, `${field}[${index}]`))
  } else if (value !== null && typeof value === 'object') {
    for (const required of schema.required ?? []) if (!(required in value)) fail(`Missing ${required}.`)
    for (const [key, item] of Object.entries(value)) {
      if (!schema.properties?.[key]) fail(`Unknown field: ${key}.`)
      validate(schema.properties![key], item, `${field}.${key}`)
    }
  }
}

export function moderateBody(body: Record<string, unknown>) {
  const fields = ['name', 'os', 'summary', 'notes', 'note', 'runtimeVersion', 'runtimeFlags', 'revision']
  moderateText(fields.filter((key) => typeof body[key] === 'string').map((key) => [key, body[key] as string, 5000]))
  if (Array.isArray(body.items)) body.items.forEach((item) => moderateBody(item as Record<string, unknown>))
}

const rename: Record<string, string> = { quant: 'quant_id' }
export function toDatabase(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toDatabase)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [rename[key] ?? key.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase()), toDatabase(item)]))
  return value
}
export function fromDatabase(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(fromDatabase)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key === 'quant_id' ? 'quant' : key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()), fromDatabase(item)]))
  return value
}

export function openApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const route of routes) {
    const parameters: unknown[] = []
    for (const name of ['id', 'handle']) if (route.path.includes(`{${name}}`)) parameters.push({ name, in: 'path', required: true, schema: { type: 'string' } })
    if (route.method !== 'GET') parameters.push({ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 1, maxLength: 128 }, description: 'Unique per logical operation. Reuse only with exactly the same request. Receipts are retained for 30 days.' })
    if (route.version) parameters.push({ name: 'If-Match', in: 'header', required: true, schema: { type: 'string' }, description: 'The quoted updatedAt timestamp from the last read.' })
    if (route.action.endsWith('.list')) for (const name of ['owner', 'q', 'cursor', 'limit', 'rig', 'model', 'runtime', 'hardware']) parameters.push({ name, in: 'query', schema: { type: 'string' }, description: name === 'limit' ? '1–100; default 25.' : undefined })
    if (route.action === 'rigs.delete') parameters.push({ name: 'cascade', in: 'query', schema: { type: 'boolean' }, description: 'Explicitly delete the rig’s results too.' })
    paths[route.path] ??= {}
    paths[route.path][route.method.toLowerCase()] = {
      operationId: route.action.replaceAll('.', '_'), description: route.description,
      security: route.scope === 'public' ? [] : [{ personalKey: [] }], parameters,
      ...(route.schema ? { requestBody: { required: true, content: { 'application/json': { schema: route.schema } } } } : {}),
      responses: Object.fromEntries([200, 201, 400, 401, 403, 404, 409, 412, 413, 415, 428, 429, 503].map((code) => [String(code), { description: code < 300 ? 'JSON data, or items and nextCursor for lists. IDs are strings; timestamps use ISO 8601. Records include a site URL.' : 'JSON { error: { code, message, fields? } }. 429 includes Retry-After.' }])),
    }
  }
  return { openapi: '3.1.0', info: { title: 'Intelinside agent API', version: '1.0.0' }, servers: [{ url: '/api/v1' }], components: { securitySchemes: { personalKey: { type: 'http', scheme: 'bearer', description: 'Create a personal key at /settings/api-keys. Never use a Supabase project secret.' } } }, paths }
}
