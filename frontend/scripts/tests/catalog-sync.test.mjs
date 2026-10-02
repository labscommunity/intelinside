import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createDatabase } from './database.mjs'
import { catalogSnapshot, loadCatalog } from '../catalog-snapshot.mjs'
import { changes, report } from '../sync-catalog.mjs'

const sha = 'a'.repeat(40)
let db, catalog
const fresh = () => structuredClone(catalog)
before(async () => {
  catalog = catalogSnapshot(await loadCatalog())
  db = await createDatabase()
})
after(async () => { await db?.close() })
const sync = async (snapshot, { dry = false, source = sha } = {}) =>
  (await db.query('select public.sync_catalog($1::jsonb, $2, $3) as result', [JSON.stringify(snapshot), source, dry])).rows[0].result
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const count = async (table) => (await one(`select count(*)::integer as n from ${table}`)).n
const newModel = (snapshot) => {
  snapshot.models.push({ ...snapshot.models[0], id: 'sync-test-7b', name: 'Sync Test 7B' })
  snapshot.model_quants.push({ model_id: 'sync-test-7b', quant_id: 'int4' })
  return snapshot
}

test('the current catalog syncs, and a second sync changes nothing', async () => {
  const first = await sync(catalog)
  assert.equal(first.source_sha, sha)
  assert.equal(first.tables.models.inserted + first.tables.models.updated + first.tables.models.unchanged, catalog.models.length)
  const second = await sync(catalog)
  assert.equal(changes(second), 0)
  assert.equal(second.tables.model_quants.unchanged, catalog.model_quants.length)
  assert.equal(second.tables.hardware.unchanged, catalog.hardware.length)
  assert.match(report(second), /\| hardware \| 0 \| 0 \| \d+ \|/)
})

test('a new model and its board are inserted without a migration, so results can reference them', async () => {
  const result = await sync(newModel(fresh()))
  assert.equal(result.tables.models.inserted, 1)
  assert.equal(result.tables.model_quants.inserted, 1)
  assert.equal(changes(result), 2)
  assert.ok(await one(`select 1 from public.model_quants where model_id = 'sync-test-7b' and quant_id = 'int4'`))
})

test('metadata edits update only the changed row and every column type round-trips', async () => {
  const snapshot = newModel(fresh())
  snapshot.models.at(-1).brand_color = '#123456'
  const cpu = snapshot.hardware.find((h) => h.integrated.length)
  cpu.specs = { ...cpu.specs, boostGhz: 9.9 }
  const result = await sync(snapshot)
  assert.equal(result.tables.models.updated, 1)
  assert.equal(result.tables.hardware.updated, 1)
  assert.equal(changes(result), 2)
  assert.equal((await one(`select brand_color from public.models where id = 'sync-test-7b'`)).brand_color, '#123456')
  const row = await one('select specs, integrated, release_date::text as release_date from public.hardware where id = $1', [cpu.id])
  assert.deepEqual([row.specs, row.integrated, row.release_date], [cpu.specs, cpu.integrated, cpu.release_date])
  assert.equal(changes(await sync(snapshot)), 0)
})

test('dry runs report the same changes and write nothing', async () => {
  const snapshot = fresh()
  snapshot.quants.push({ id: 'q3_k_s', label: 'Q3_K_S', bits: 3, format: 'GGUF' })
  const before = await count('public.quants')
  const result = await sync(snapshot, { dry: true })
  assert.equal(result.dry_run, true)
  assert.equal(result.tables.quants.inserted, 1)
  assert.equal(await count('public.quants'), before)
})

test('rows missing from the catalog are reported and kept', async () => {
  const result = await sync(fresh())
  assert.deepEqual(result.tables.models.not_in_catalog, ['sync-test-7b'])
  assert.deepEqual(result.tables.model_quants.not_in_catalog, ['sync-test-7b/int4'])
  assert.ok(await one(`select 1 from public.models where id = 'sync-test-7b'`))
  assert.match(report(result), /models: sync-test-7b/)
})

test('a bad snapshot rolls back completely', async () => {
  const before = await count('public.models')
  const broken = [
    [(s) => { newModel(s); s.model_quants.push({ model_id: 'sync-test-7b', quant_id: 'no-such-quant' }) }, /model_quants_quant_id_fkey|foreign key/],
    [(s) => { s.models.push({ ...s.models[0], id: 'rollback-me' }); s.models.push({ ...s.models[0], id: 'rollback-me' }) }, /repeats a models key/],
    [(s) => { s.models.push({ ...s.models[0], id: 'rollback-me', brand: 'Extra' }) }, /field this database does not sync/],
    [(s) => { s.models.push({ ...s.models[0], id: 'rollback-me' }); s.hardware.find((h) => h.integrated.length).integrated.push('no-such-part') }, /Integrated hardware does not exist/],
    [(s) => { s.models.push({ ...s.models[0], id: 'rollback-me', architecture: 'sparse' }) }, /check constraint/],
    [(s) => { s.models.push({ ...s.models[0], id: 'rollback-me' }); s.runtimes = [] }, /between 1 and 10000 runtimes/],
    [(s) => { s.models.push({ ...s.models[0], id: 'rollback-me' }); s.extra = [] }, /must be an object of/],
  ]
  for (const [edit, error] of broken) {
    const snapshot = fresh()
    edit(snapshot)
    await assert.rejects(sync(snapshot), error)
  }
  await assert.rejects(sync(newModel(fresh()), { source: 'main' }), /provenance/)
  assert.equal(await count('public.models'), before)
  assert.equal(await one(`select 1 as found from public.models where id = 'rollback-me'`), undefined)
})

test('only the service role can run the sync', async () => {
  const can = async (role, fn) => (await one('select has_function_privilege($1, $2, \'execute\') as ok', [role, fn])).ok
  const rpc = 'public.sync_catalog(jsonb, text, boolean)'
  const helper = 'private.sync_catalog_table(text, jsonb, text[], text[], text[])'
  assert.equal(await can('service_role', rpc), true)
  for (const role of ['anon', 'authenticated']) assert.equal(await can(role, rpc), false)
  for (const role of ['anon', 'authenticated', 'service_role']) assert.equal(await can(role, helper), false)
})
