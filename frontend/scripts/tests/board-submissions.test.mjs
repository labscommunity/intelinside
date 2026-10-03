import { test, before, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

let supabaseApi
const run = (id, component, quantity, tps, extra = {}) => ({
  id, rig_id: 1, submitter_id: 'owner', model_id: 'qwen3-8-27b', quant_id: 'q4_k_m',
  component_id: component, component_quantity: quantity, decode_tps: tps,
  runtime_id: 'llamacpp', runtime_version: `b${id}`, run_date: '2026-09-20',
  verification_status: 'self_reported', confirmations_count: 0, flags_count: 0, hidden: false,
  ...extra,
})
const results = [
  run(1, 'intel-arc-pro-b70', 1, 50),
  run(2, 'intel-arc-pro-b70', 1, 60),
  run(3, 'intel-arc-pro-b70', 1, 60, { run_date: '2026-09-19' }),
  run(4, 'intel-arc-pro-b60', 1, 40),
  run(5, 'intel-arc-pro-b60', 2, 70),
  run(6, null, null, 80),
  run(7, 'intel-arc-pro-b70', 1, 90, { hidden: true }),
  run(8, 'intel-arc-pro-b70', 1, 100, { custom_runtime_id: 1 }),
  run(9, 'intel-arc-pro-b70', 1, 110, { quant_id: 'int4' }),
]

before(async () => {
  mock.method(globalThis, 'fetch', async (url, init) => {
    const parsed = new URL(url)
    assert.equal(parsed.origin, 'https://board-test.supabase.invalid')
    assert.equal(init.method, 'GET')
    const tables = {
      results,
      rigs: [{ id: 1, owner_id: 'owner', name: 'Test rig', os: 'Linux', created_at: '2026-09-01' }],
    }
    return Response.json(tables[parsed.pathname.split('/').at(-1)] ?? [])
  })
  const bundle = await build({
    stdin: {
      contents: `export { supabaseApi } from './lib/api/supabase'; export { supabase } from './lib/auth';`,
      resolveDir: fileURLToPath(new URL('../../src', import.meta.url)),
    },
    alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) },
    define: { 'import.meta.env': JSON.stringify({
      VITE_SUPABASE_URL: 'https://board-test.supabase.invalid',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_board_test',
    }) },
    bundle: true, write: false, platform: 'browser', format: 'esm', logLevel: 'silent',
  })
  const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`)
  supabaseApi = api.supabaseApi
  await api.supabase.auth.getSession()
  await api.supabase.auth.stopAutoRefresh()
})
after(() => mock.restoreAll())

const board = (params = {}) => supabaseApi.board('qwen3-8-27b', 'q4_k_m', { kind: 'components', ...params })
const ids = (response) => response.items.map((row) => row.result.id)

test('five component submissions remain three leaderboard configurations by default', async () => {
  const grouped = await board()
  assert.equal(grouped.board.total, 3)
  assert.deepEqual(ids(grouped), ['5', '3', '4'])
  const all = await board({ allSubmissions: true })
  assert.equal(all.board.total, 5)
  assert.deepEqual(ids(all), ['5', '3', '2', '1', '4'])
  assert.deepEqual(all.items.map((row) => row.result.runtimeVersion), ['b5', 'b3', 'b2', 'b1', 'b4'])
  assert.deepEqual(ids(await board()), ids(grouped), 'viewing submissions must not alter ranking')
})

test('all submissions preserve board split, filters, and hidden/modified exclusions', async () => {
  assert.deepEqual(ids(await board({ allSubmissions: true, kind: 'rigs' })), ['6'])
  assert.deepEqual(ids(await board({ allSubmissions: true, q: 'B70' })), ['3', '2', '1'])
  assert.equal((await board({ allSubmissions: true, runtime: ['vllm'] })).board.total, 0)
  assert.equal((await board({ allSubmissions: true, verification: 'community_verified' })).board.total, 0)
  assert.equal((await board({ allSubmissions: true, type: 'cpu' })).board.total, 0)
  assert.deepEqual(ids(await board({ allSubmissions: true, includeModified: true })), ['8', '5', '3', '2', '1', '4'])
})

test('all-submissions pagination counts all matches and retains repeated configurations', async () => {
  const pages = []
  let cursor
  do {
    const page = await board({ allSubmissions: true, limit: 2, cursor })
    assert.equal(page.board.total, 5)
    pages.push(...ids(page))
    cursor = page.nextCursor
  } while (cursor)
  assert.deepEqual(pages, ['5', '3', '2', '1', '4'])
})
