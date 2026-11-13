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
const standard = { input_tokens: 512, output_tokens: 256, concurrency: 1, speculative: 'none', decode_method: 'streamed' }
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
  // Quants outside the model's suggested list: one visible, one hidden.
  run(10, 'intel-arc-pro-b70', 1, 30, { quant_id: 'iq2_xxs' }),
  run(11, 'intel-arc-pro-b70', 1, 30, { quant_id: 'q2_0', hidden: true }),
  // Q8_0 board: results with and without recorded conditions, for the setup tabs.
  run(12, 'intel-arc-pro-b70', 1, 40, { quant_id: 'q8_0', ...standard }),
  run(13, 'intel-arc-pro-b70', 1, 90, { quant_id: 'q8_0', ...standard, speculative: 'lossless' }),
  run(14, 'intel-arc-pro-b60', 1, 50, { quant_id: 'q8_0', ...standard, decode_method: 'wall' }),
  run(15, 'intel-arc-pro-b60', 2, 100, { quant_id: 'q8_0' }),
  run(16, 'intel-arc-pro-b70', 1, 20, { quant_id: 'q8_0', ...standard, concurrency: 4, decode_scope: 'per_request' }),
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

test('a quant outside the suggested list gets its own board once it has visible results', async () => {
  const model = (await supabaseApi.models()).find((m) => m.id === 'qwen3-8-27b')
  assert.deepEqual(model.quants, ['int4', 'int8', 'fp8', 'q4_k_m', 'q4_k_l', 'q8_0', 'exl3-4bpw', 'exl3-5bpw', 'mlx-4bit', 'iq2_xxs'])
  assert.equal(model.resultCounts.iq2_xxs, 1)
  assert.deepEqual(ids(await supabaseApi.board('qwen3-8-27b', 'iq2_xxs', { kind: 'components' })), ['10'])
  // Any catalog quant has a board, even an empty one; only unknown quants are missing.
  assert.equal((await supabaseApi.board('qwen3-8-27b', 'q2_0', { kind: 'components' })).board.total, 0)
  await assert.rejects(supabaseApi.board('qwen3-8-27b', 'not-a-quant', { kind: 'components' }), /No such board/)
})

test('setup tabs rank only results measured that way, and count every setup', async () => {
  const q8 = (setup, extra = {}) => supabaseApi.board('qwen3-8-27b', 'q8_0', { kind: 'components', setup, ...extra })
  const all = await q8(undefined)
  assert.deepEqual(ids(all), ['15', '13', '14'], 'All results keeps everything, best per part')
  assert.deepEqual(all.setupCounts, { standard: 1, speculative: 1, long: 0, concurrent: 1, all: 3 })
  assert.deepEqual(ids(await q8('standard')), ['12'], 'speculation, wall clock and 4 requests stay out of Standard')
  assert.deepEqual(ids(await q8('speculative')), ['13'])
  assert.deepEqual(ids(await q8('concurrent')), ['16'])
  assert.equal((await q8('long')).board.total, 0)
  assert.deepEqual(ids(await q8('all')), ids(all))
  // Other filters still apply inside a setup, and the counts follow them.
  assert.deepEqual((await q8(undefined, { q: 'B60' })).setupCounts, { standard: 0, speculative: 0, long: 0, concurrent: 0, all: 2 })
})

test('a result page shows its own rank, or names the result that holds its part\'s row', async () => {
  const rank = async (id) => (await supabaseApi.result(id)).rank
  // Q4_K_M components board: 5 (2× B60), 3 (B70), 4 (B60). Results 1 and 2 are slower B70 runs.
  assert.deepEqual(await rank('3'), { kind: 'components', setup: 'all', boardSize: 3, position: 2 })
  assert.deepEqual(await rank('1'), { kind: 'components', setup: 'all', boardSize: 3, heldBy: { id: '3', position: 2 } }, 'a slower run does not borrow #2')
  assert.deepEqual(await rank('2'), { kind: 'components', setup: 'all', boardSize: 3, heldBy: { id: '3', position: 2 } }, 'a tie goes to the earlier run')
  assert.deepEqual(await rank('6'), { kind: 'rigs', setup: 'all', boardSize: 1, position: 1 })
})

test('a result page ranks within the result\'s own setup', async () => {
  const rank = async (id) => (await supabaseApi.result(id)).rank
  // On All results, result 13 (speculative, 90) holds the B70 row. Each setup is its own board.
  assert.deepEqual(await rank('12'), { kind: 'components', setup: 'standard', boardSize: 1, position: 1 })
  assert.deepEqual(await rank('13'), { kind: 'components', setup: 'speculative', boardSize: 1, position: 1 })
  assert.deepEqual(await rank('16'), { kind: 'components', setup: 'concurrent', boardSize: 1, position: 1 })
  // Conditions that match no setup (wall clock) or none recorded rank on All results.
  assert.deepEqual(await rank('14'), { kind: 'components', setup: 'all', boardSize: 3, position: 3 })
  assert.deepEqual(await rank('15'), { kind: 'components', setup: 'all', boardSize: 3, position: 1 })
})
