import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createDatabase, seedUsers, owner, other } from '../agent-api/database.mjs'

// Database rules from issue #130, exercised through the same role, grants and RLS a browser session gets.
let db, llamaBuild, ovBuild
before(async () => {
  db = await createDatabase()
  await seedUsers(db)
  await db.query(`insert into public.rigs(owner_id,name) values ($1,'Alice rig')`, [owner])
  const builds = await db.query(`insert into public.custom_runtimes(owner_id,runtime_id,name,repo_url,summary) values
    ($1,'llamacpp','Alice llama','https://github.com/example/llama','A llama.cpp fork'),
    ($1,'openvino-genai','Alice OV','https://github.com/example/ov','An OpenVINO fork') returning id`, [owner])
  ;[llamaBuild, ovBuild] = builds.rows.map((row) => row.id)
})
after(async () => { await db?.close() })

async function as(user, fn) {
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, role: 'authenticated' })])
  await db.exec('set role authenticated')
  try { return await fn() }
  finally { await db.exec("reset role; select set_config('request.jwt.claims','',false)") }
}
const insertResult = (runtime, build) => as(owner, async () => (await db.query(`insert into public.results
  (submitter_id,rig_id,model_id,quant_id,runtime_id,runtime_version,decode_tps,run_date,custom_runtime_id)
  values ($1,1,'qwen3-8b','q4_k_m',$2,'integrity',34.2,'2026-09-04',$3) returning id`, [owner, runtime, build])).rows[0].id)

for (const [column, value] of [['runtime_flags', '-fa on'], ['custom_runtime_id', null], ['revision', 'abc123']]) {
  test(`editing only ${column} resets confirmations`, async () => {
    const id = await insertResult('llamacpp', llamaBuild)
    await as(other, () => db.query('insert into public.result_confirmations(result_id,user_id) values ($1,$2)', [id, other]))
    assert.equal((await db.query('select confirmations_count n from public.results where id=$1', [id])).rows[0].n, 1)
    await as(owner, () => db.query(`update public.results set ${column} = $1 where id = $2`, [value, id]))
    const { rows } = await db.query(`select confirmations_count, verification_status,
      (select count(*)::int from public.result_confirmations where result_id = $1) stored from public.results where id = $1`, [id])
    assert.deepEqual(rows[0], { confirmations_count: 0, verification_status: 'self_reported', stored: 0 })
  })
}

test('a result cannot use a custom build of a different runtime', async () => {
  await assert.rejects(insertResult('llamacpp', ovBuild), /results_custom_runtime_base_fkey/)
  const id = await insertResult('llamacpp', llamaBuild)
  await assert.rejects(as(owner, () => db.query(`update public.results set runtime_id = 'openvino-genai' where id = $1`, [id])),
    /results_custom_runtime_base_fkey/)
  await assert.rejects(as(owner, () => db.query('update public.results set custom_runtime_id = $1 where id = $2', [ovBuild, id])),
    /results_custom_runtime_base_fkey/)
  // Stock results are unaffected, and a matching build still works.
  assert.ok(await insertResult('openvino-genai', null))
  assert.ok(await insertResult('openvino-genai', ovBuild))
})

test('a build in use cannot move to another base runtime', async () => {
  await insertResult('llamacpp', llamaBuild)
  await assert.rejects(as(owner, () => db.query(`update public.custom_runtimes set runtime_id = 'vllm' where id = $1`, [llamaBuild])),
    /results_custom_runtime_base_fkey/)
  const { rows } = await db.query(`insert into public.custom_runtimes(owner_id,runtime_id,name,repo_url,summary)
    values ($1,'llamacpp','Unused','https://github.com/example/unused','Not referenced') returning id`, [owner])
  await as(owner, () => db.query(`update public.custom_runtimes set runtime_id = 'vllm' where id = $1`, [rows[0].id]))
})

test('any catalog quant is valid for any catalog model; unknown ids are not', async () => {
  // ptq1_0 is suggested only for Ternary Bonsai, not for Qwen3-8B.
  const ok = await as(owner, () => db.query(`insert into public.results
    (submitter_id,rig_id,model_id,quant_id,runtime_id,runtime_version,decode_tps,run_date)
    values ($1,1,'qwen3-8b','ptq1_0','llamacpp','any-quant',34.2,'2026-09-04') returning id`, [owner]))
  assert.equal(ok.rows.length, 1)
  for (const [model, quant, key] of [['qwen3-8b', 'not-a-quant', 'results_quant_id_fkey'], ['not-a-model', 'q4_k_m', 'results_model_id_fkey']]) {
    await assert.rejects(as(owner, () => db.query(`insert into public.results
      (submitter_id,rig_id,model_id,quant_id,runtime_id,runtime_version,decode_tps,run_date)
      values ($1,1,$2,$3,'llamacpp','any-quant',34.2,'2026-09-04')`, [owner, model, quant])), new RegExp(key))
  }
})
