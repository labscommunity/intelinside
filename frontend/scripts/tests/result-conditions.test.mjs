import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createDatabase, seedUsers, owner, other } from '../agent-api/database.mjs'
import { loadResultParser, prepareFile } from '../pr-results.mjs'

// Conditions behind a result (issue #130 step 3): optional fields, stored by every writer, validated the same way.
const repository = 'labscommunity/intelinside'
const conditions = {
  inputTokens: 512, outputTokens: 256, concurrency: 4, decodeScope: 'per_request', decodeMethod: 'streamed',
  repeats: 3, promptCache: false, thinking: false, speculative: 'lossless',
}
const raw = { rig: '1', model: 'qwen3-8b', quant: 'q4_k_m', runtime: 'llamacpp', runtimeVersion: 'b6512', decodeTps: 34.2, runDate: '2026-09-04' }
let db, parseResultFile
before(async () => {
  parseResultFile = await loadResultParser()
  db = await createDatabase()
  await seedUsers(db)
  await db.query(`insert into auth.identities values ('github','123',$1)`, [owner])
  await db.query(`insert into public.rigs(owner_id,name) values ($1,'Alice rig')`, [owner])
})
after(async () => { await db?.close() })

async function as(user, fn) {
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, role: 'authenticated' })])
  await db.exec('set role authenticated')
  try { return await fn() }
  finally { await db.exec("reset role; select set_config('request.jwt.claims','',false)") }
}
const insert = (columns) => as(owner, async () => {
  const keys = ['submitter_id', 'rig_id', 'model_id', 'quant_id', 'runtime_id', 'runtime_version', 'decode_tps', 'run_date', ...Object.keys(columns)]
  const values = [owner, 1, 'qwen3-8b', 'q4_k_m', 'llamacpp', 'b6512', 34.2, '2026-09-04', ...Object.values(columns)]
  return (await db.query(`insert into public.results (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')}) returning *`, values)).rows[0]
})

test('the parser keeps valid conditions and the export writes them back', () => {
  const { file, problems } = parseResultFile({ ...raw, ...conditions, revision: 'b6512' })
  assert.deepEqual(problems, [])
  for (const [key, value] of Object.entries(conditions)) assert.equal(file[key], value, key)
  assert.equal(file.revision, 'b6512', 'a stock run may carry its engine revision')
})

test('the parser names every invalid condition', () => {
  const bad = { inputTokens: 0, outputTokens: 2.5, repeats: '3', promptCache: 'no', decodeMethod: 'stopwatch', speculative: 'yes' }
  const { problems } = parseResultFile({ ...raw, ...bad })
  for (const key of Object.keys(bad)) assert.ok(problems.some((p) => p.includes(`"${key}"`)), `${key}: ${problems.join(' | ')}`)
  assert.match(parseResultFile({ ...raw, concurrency: 1, decodeScope: 'total' }).problems.join(' '), /decodeScope.*above 1/)
  assert.match(parseResultFile({ ...raw, decodeScope: 'total' }).problems.join(' '), /decodeScope.*above 1/)
  assert.throws(() => prepareFile('results/alice/run.json', 'added', { ...raw, thinking: 'on' }, 'alice', parseResultFile), /thinking/)
})

test('PR ingestion stores the conditions', async () => {
  const { file } = prepareFile('results/alice/conditions.json', 'added', { ...raw, ...conditions }, 'alice', parseResultFile)
  const answer = (await db.query('select public.ingest_pr_results($1,$2,$3,$4::jsonb,$5) as result',
    [repository, 77, '123', JSON.stringify([{ path: 'results/alice/conditions.json', file }]), false])).rows[0].result
  const row = (await db.query('select * from public.results where id = $1', [answer[0].id])).rows[0]
  assert.deepEqual(
    { inputTokens: row.input_tokens, outputTokens: row.output_tokens, concurrency: row.concurrency, decodeScope: row.decode_scope,
      decodeMethod: row.decode_method, repeats: row.repeats, promptCache: row.prompt_cache, thinking: row.thinking, speculative: row.speculative },
    conditions)
})

test('a browser write stores conditions and a revision on a stock run', async () => {
  const row = await insert({ input_tokens: 4096, decode_method: 'wall', thinking: true, revision: 'b6512' })
  assert.equal(row.input_tokens, 4096)
  assert.equal(row.decode_method, 'wall')
  assert.equal(row.thinking, true)
  assert.equal(row.custom_runtime_id, null)
  assert.equal(row.revision, 'b6512')
})

test('the database rejects invalid conditions from any writer', async () => {
  for (const [columns, constraint] of [
    [{ decode_method: 'stopwatch' }, 'results_decode_method_valid'],
    [{ speculative: 'maybe' }, 'results_speculative_valid'],
    [{ decode_scope: 'everything', concurrency: 4 }, 'results_decode_scope_valid'],
    [{ decode_scope: 'total', concurrency: 1 }, 'results_decode_scope_needs_concurrency'],
    [{ decode_scope: 'total' }, 'results_decode_scope_needs_concurrency'],
    [{ input_tokens: 0 }, 'results_input_tokens_positive'],
    [{ repeats: -1 }, 'results_repeats_positive'],
  ]) await assert.rejects(insert(columns), new RegExp(constraint), constraint)
})

test('editing only a condition resets confirmations', async () => {
  const { id } = await insert({ input_tokens: 512 })
  await as(other, () => db.query('insert into public.result_confirmations(result_id,user_id) values ($1,$2)', [id, other]))
  assert.equal((await db.query('select confirmations_count n from public.results where id=$1', [id])).rows[0].n, 1)
  await as(owner, () => db.query('update public.results set input_tokens = 4096 where id = $1', [id]))
  assert.equal((await db.query('select confirmations_count n from public.results where id=$1', [id])).rows[0].n, 0)
})
