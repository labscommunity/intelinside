import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createDatabase, seedUsers, owner, other } from '../agent-api/database.mjs'
import { loadResultParser, prepareFile } from '../pr-results.mjs'

// Runs and details (issue #130 step 4, light version): a file with points becomes one result per point sharing a
// run id; any result can name its model file and the spread of its repeats.
const repository = 'labscommunity/intelinside'
const sha = 'a'.repeat(64)
const shared = {
  rig: '1', model: 'qwen3-8b', quant: 'q4_k_m', runtime: 'llamacpp', runtimeVersion: 'b6512', runDate: '2026-11-18',
  outputTokens: 256, decodeMethod: 'streamed', repeats: 3, speculative: 'none',
  modelRepo: 'Qwen/Qwen3-8B-GGUF', modelFile: 'Qwen3-8B-Q4_K_M.gguf', modelSha256: sha,
}
const points = [
  { inputTokens: 512, concurrency: 1, decodeTps: 20.66, decodeTpsMin: 20.5, decodeTpsMax: 20.8 },
  { inputTokens: 4096, concurrency: 1, decodeTps: 18.51 },
  { inputTokens: 512, concurrency: 4, decodeScope: 'total', decodeTps: 28.8 },
]
const single = { ...shared, decodeTps: 34.2, inputTokens: 512, concurrency: 1 }
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
  const values = [owner, 1, 'qwen3-8b', 'q4_k_m', 'llamacpp', 'b6512', 34.2, '2026-11-18', ...Object.values(columns)]
  return (await db.query(`insert into public.results (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')}) returning *`, values)).rows[0]
})
const ingest = async (path, raw, { pr = 90, dryRun = false } = {}) => {
  const { file } = prepareFile(path, 'added', raw, 'alice', parseResultFile)
  return (await db.query('select public.ingest_pr_results($1,$2,$3,$4::jsonb,$5) as result',
    [repository, pr, '123', JSON.stringify([{ path, file }]), dryRun])).rows[0].result
}

test('the parser keeps details, lowercases the hash, and checks the spread against the rate', () => {
  const { file, problems } = parseResultFile({ ...single, modelSha256: sha.toUpperCase(), decodeTpsMin: 33.9, decodeTpsMax: 34.6 })
  assert.deepEqual(problems, [])
  assert.equal(file.modelSha256, sha)
  assert.equal(file.modelFile, 'Qwen3-8B-Q4_K_M.gguf')
  assert.equal(file.decodeTpsMax, 34.6)
  assert.match(parseResultFile({ ...single, decodeTpsMin: 35 }).problems.join(' '), /decodeTpsMin.*at most/)
  assert.match(parseResultFile({ ...single, decodeTpsMax: 30 }).problems.join(' '), /decodeTpsMax.*at least/)
  assert.match(parseResultFile({ ...single, modelSha256: 'abc' }).problems.join(' '), /modelSha256/)
  assert.match(parseResultFile({ ...single, modelFile: '' }).problems.join(' '), /modelFile/)
})

test('the parser reads a file with points as one full result per point', () => {
  const { file, problems } = parseResultFile({ ...shared, points })
  assert.deepEqual(problems, [])
  assert.equal(file.points.length, 3)
  assert.equal(file.decodeTps, undefined, 'measured numbers live in the points')
  assert.equal(file.modelRepo, shared.modelRepo)
  assert.deepEqual(file.points[2], { decodeTps: 28.8, inputTokens: 512, outputTokens: 256, concurrency: 4, decodeScope: 'total' })
})

test('the parser names point problems once when shared, by point otherwise', () => {
  const shared1 = parseResultFile({ ...shared, model: 'not-a-model', points }).problems
  assert.equal(shared1.filter((p) => p.includes('not-a-model')).length, 1)
  assert.ok(!shared1.some((p) => p.startsWith('points[') && p.includes('not-a-model')))
  const one = parseResultFile({ ...shared, points: [points[0], { ...points[1], decodeTps: -1 }] }).problems
  assert.deepEqual(one, ['points[1]: "decodeTps" must be a number above zero.'])
  assert.match(parseResultFile({ ...shared, decodeTps: 3, points }).problems.join(' '), /"decodeTps" goes in each point/)
  assert.match(parseResultFile({ ...shared, points: [{ ...points[0], notes: 'x' }] }).problems.join(' '), /points\[0\]: "notes" cannot vary/)
  assert.match(parseResultFile({ ...shared, points: [points[0], { ...points[0] }] }).problems.join(' '), /points\[1\] repeats points\[0\]/)
  assert.match(parseResultFile({ ...shared, points: [] }).problems.join(' '), /1 to 64 points/)
  assert.match(parseResultFile({ ...shared, points: [{ inputTokens: 512, concurrency: 2, decodeScope: 'total', decodeTps: 9 }, { inputTokens: 512, concurrency: 1, decodeScope: 'total', decodeTps: 9 }] }).problems.join(' '),
    /points\[1\]: "decodeScope" only applies/)
  assert.throws(() => prepareFile('results/alice/sweep.json', 'added', { ...shared, points: 'many' }, 'alice', parseResultFile), /points/)
})

test('PR ingestion turns points into results sharing a run id, and a retry reports them all', async () => {
  const dry = await ingest('results/alice/sweep.json', { ...shared, points }, { dryRun: true })
  assert.deepEqual(dry, [{ path: 'results/alice/sweep.json', status: 'validated', id: null, points: 3 }])
  assert.equal((await db.query('select count(*)::int n from public.results')).rows[0].n, 0, 'dry runs roll back')

  const [answer] = await ingest('results/alice/sweep.json', { ...shared, points })
  assert.equal(answer.status, 'imported')
  assert.equal(answer.ids.length, 3)
  assert.equal(answer.id, answer.ids[0])
  const rows = (await db.query('select * from public.results where id = any($1::bigint[]) order by id', [answer.ids])).rows
  assert.equal(new Set(rows.map((r) => r.run_id)).size, 1)
  assert.ok(rows[0].run_id)
  assert.deepEqual(rows.map((r) => [r.input_tokens, r.concurrency, r.decode_scope, Number(r.decode_tps)]),
    [[512, 1, null, 20.66], [4096, 1, null, 18.51], [512, 4, 'total', 28.8]])
  for (const r of rows) {
    assert.equal(r.model_file, shared.modelFile)
    assert.equal(r.model_sha256, sha)
    assert.equal(r.output_tokens, 256, 'shared conditions reach every point')
  }
  assert.equal(Number(rows[0].decode_tps_min), 20.5)
  assert.equal(rows[1].decode_tps_min, null, 'a point keeps only its own spread')

  const [again] = await ingest('results/alice/sweep.json', { ...shared, points })
  assert.equal(again.status, 'already_imported')
  assert.deepEqual(again.ids, answer.ids)
})

test('a single-result file gets no run id but keeps its details', async () => {
  const [answer] = await ingest('results/alice/single.json', { ...single, decodeTpsMin: 33.9, decodeTpsMax: 34.6 }, { pr: 91 })
  assert.equal(answer.ids, undefined)
  const row = (await db.query('select * from public.results where id = $1', [answer.id])).rows[0]
  assert.equal(row.run_id, null)
  assert.equal(row.model_repo, shared.modelRepo)
  assert.equal(Number(row.decode_tps_max), 34.6)
})

test('a browser writes details but can never set a run id', async () => {
  const row = await insert({ model_file: 'x.gguf', model_sha256: sha, decode_tps_min: 30, decode_tps_max: 35 })
  assert.equal(row.model_file, 'x.gguf')
  await assert.rejects(insert({ run_id: '00000000-0000-0000-0000-0000000000aa' }), /permission denied/)
  await assert.rejects(as(owner, () => db.query("update public.results set run_id = gen_random_uuid() where id = $1", [row.id])), /permission denied/)
  await assert.rejects(as(owner, () => db.query('select private.assign_result_run($1, gen_random_uuid())', [row.id])), /permission denied/)
})

test('the database rejects invalid details from any writer', async () => {
  for (const [columns, constraint] of [
    [{ model_sha256: 'A'.repeat(64) }, 'results_model_sha256_hex'],
    [{ model_sha256: 'abc' }, 'results_model_sha256_hex'],
    [{ model_file: '' }, 'results_model_file_length'],
    [{ model_repo: 'x'.repeat(201) }, 'results_model_repo_length'],
    [{ decode_tps_min: 40 }, 'results_decode_tps_min_range'],
    [{ decode_tps_min: 0 }, 'results_decode_tps_min_range'],
    [{ decode_tps_max: 30 }, 'results_decode_tps_max_range'],
  ]) await assert.rejects(insert(columns), new RegExp(constraint), constraint)
})

test('editing only a detail resets confirmations', async () => {
  const { id } = await insert({ model_file: 'a.gguf' })
  await as(other, () => db.query('insert into public.result_confirmations(result_id,user_id) values ($1,$2)', [id, other]))
  assert.equal((await db.query('select confirmations_count n from public.results where id=$1', [id])).rows[0].n, 1)
  await as(owner, () => db.query("update public.results set model_file = 'b.gguf' where id = $1", [id]))
  assert.equal((await db.query('select confirmations_count n from public.results where id=$1', [id])).rows[0].n, 0)
})
