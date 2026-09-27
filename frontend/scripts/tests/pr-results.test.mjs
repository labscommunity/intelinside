import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createDatabase } from '../agent-api/database.mjs'
import { prepareFile, collectFiles, processPr, loadResultParser } from '../pr-results.mjs'

const repository = 'labscommunity/intelinside'
const owner = '00000000-0000-0000-0000-000000000001'
const other = '00000000-0000-0000-0000-000000000002'
const raw = { rig: '1', model: 'qwen3-8b', quant: 'q4_k_m', runtime: 'llamacpp', runtimeVersion: 'b6512', decodeTps: 34.2, runDate: '2026-09-04' }
const entry = (name, changes = {}) => ({ path: `results/alice/${name}.json`, file: { ...raw, ...changes } })
let db, parseResultFile
const migrations = new URL('../../../supabase/migrations/', import.meta.url)
const evidenceMigration = '20260918090000_optional_result_evidence.sql'
before(async () => {
  parseResultFile = await loadResultParser()
  db = await createDatabase()
  await db.query(`insert into auth.users(id, email, raw_user_meta_data) values
    ($1, 'alice@example.test', '{"user_name":"old-alice-name"}'),
    ($2, 'bob@example.test', '{"user_name":"alice","provider_id":"123"}');`, [owner, other])
  await db.query(`insert into auth.identities values ('github','123',$1), ('github','456',$2)`, [owner, other])
  await db.query(`insert into public.rigs(owner_id,name) values ($1,'Alice rig'), ($2,'Bob rig')`, [owner, other])
  await db.exec(`insert into public.rig_components values (1, 'intel-arc-b580', 1);
    insert into public.custom_runtimes(owner_id,runtime_id,name,repo_url,summary)
    values ('${other}','llamacpp','Custom llama','https://github.com/example/llama','A custom build');`)
})
after(async () => { await db?.close() })
const count = async (table) => (await db.query(`select count(*)::integer as n from ${table}`)).rows[0].n
async function rpc(files, { id = '123', pr = 42, dry = false } = {}) {
  return (await db.query('select public.ingest_pr_results($1,$2,$3,$4::jsonb,$5) as result',
    [repository, pr, id, JSON.stringify(files), dry])).rows[0].result
}

test('parser rejects wrong folders, edits, invalid dates, quantities, and catalog IDs', () => {
  assert.throws(() => prepareFile('results/bob/run.json', 'added', raw, 'alice', parseResultFile), /put the file/)
  assert.throws(() => prepareFile('results/alice/run.json', 'modified', raw, 'alice', parseResultFile), /Only new files/)
  for (const status of ['renamed', 'copied']) assert.throws(() => prepareFile('results/alice/run.json', status, raw, 'alice', parseResultFile), /Only new files/)
  assert.throws(() => prepareFile('results/alice/run.json', 'added', { ...raw, runDate: '2026-02-30' }, 'alice', parseResultFile), /calendar date/)
  assert.throws(() => prepareFile('results/alice/run.json', 'added', { ...raw, decodeTps: -1 }, 'alice', parseResultFile), /above zero/)
  assert.throws(() => prepareFile('results/alice/run.json', 'added', { ...raw, model: 'missing' }, 'alice', parseResultFile), /catalog/)
  assert.equal(prepareFile('results/ALICE/run.json', 'added', raw, 'alice', parseResultFile).file.decodeTps, 34.2)
  assert.equal(prepareFile('results/alice/run.json', 'modified', { ...raw, result: 'https://example.test/results/1' }, 'alice', parseResultFile).file.result, 'https://example.test/results/1')
})

test('PR evidence is optional, retains HTTPS links on any host, and rejects invalid links', () => {
  assert.equal(parseResultFile(raw).file.evidenceUrl, undefined)
  for (const evidenceUrl of ['https://gist.github.com/alice/123', 'https://example.com/logs/run.txt?raw=1#sample']) {
    const prepared = prepareFile('results/alice/evidence.json', 'added', { ...raw, evidenceUrl }, 'alice', parseResultFile)
    assert.equal(prepared.file.evidenceUrl, evidenceUrl)
  }
  for (const evidenceUrl of ['http://example.com/log', 'javascript:alert(1)', '/logs/run', 'https://', 'https://example.com/a b', 'https://user:pass@example.com', 42]) {
    assert.throws(() => prepareFile('results/alice/evidence.json', 'added', { ...raw, evidenceUrl }, 'alice', parseResultFile), /evidenceUrl/)
  }
})

test('GitHub identity is required; editable metadata and matching handles cannot impersonate it', async () => {
  await assert.rejects(rpc([entry('missing')], { id: '999' }), /Sign up/)
  await assert.rejects(rpc([entry('wrong-owner')], { id: '456' }), /rig must identify/)
  const before = await count('public.results')
  assert.equal((await rpc([entry('rename')], { dry: true }))[0].status, 'validated')
  assert.equal(await count('public.results'), before)
  assert.equal(await count('private.pr_result_imports'), 0)
})

test('database validates quantity, membership, model/quant, build/runtime, and ambiguous names', async () => {
  await assert.rejects(rpc([entry('quantity', { component: 'intel-arc-b580', componentQuantity: 2 })]), /quantity exceeds/)
  await assert.rejects(rpc([entry('member', { component: 'missing', componentQuantity: 1 })]), /quantity exceeds/)
  await assert.rejects(rpc([entry('quant', { quant: 'missing' })]), /foreign key/)
  await assert.rejects(rpc([entry('build', { customRuntime: '1', runtime: 'vllm' })]), /customRuntime/)
  await db.query(`insert into public.rigs(owner_id,name) values ($1,'Alice rig')`, [owner])
  await assert.rejects(rpc([entry('name', { rig: 'Alice rig' })]), /exactly one/)
  assert.equal((await rpc([entry('custom', { customRuntime: '1', revision: 'abc123' })], { dry: true }))[0].status, 'validated')
})

test('batch failures roll back earlier files and receipts in both modes', async () => {
  for (const dry of [false, true]) {
    const before = await count('public.results')
    await assert.rejects(rpc([entry('valid-first'), entry('invalid-second', { decodeTps: -1 })], { dry }), /check constraint/)
    assert.equal(await count('public.results'), before)
    assert.equal(await count('private.pr_result_imports'), 0)
  }
})

test('merge attributes results by OAuth ID, retries are idempotent, and changed imports fail', async () => {
  const files = [entry('imported', { component: 'intel-arc-b580' }), entry('imported-two')]
  const imported = await rpc(files)
  assert.deepEqual(imported.map((r) => r.status), ['imported', 'imported'])
  const { rows } = await db.query('select submitter_id, repo_url, source_pr_url, component_quantity from public.results where id = $1', [imported[0].id])
  assert.equal(rows[0].submitter_id, owner)
  assert.equal(rows[0].repo_url, null)
  assert.equal(rows[0].source_pr_url, `https://github.com/${repository}/pull/42`)
  assert.equal(rows[0].component_quantity, 1)
  const before = await count('public.results')
  const retry = await rpc(files)
  assert.deepEqual(retry.map((r) => r.id), imported.map((r) => r.id))
  assert.ok(retry.every((r) => r.status === 'already_imported'))
  assert.equal(await count('public.results'), before)
  await assert.rejects(rpc([entry('imported', { decodeTps: 99 })]), /already imported/)
  await assert.rejects(rpc(files, { pr: 43 }), /already imported/)
  await db.query('delete from public.results where id = $1', [imported[0].id])
  const deletedRetry = await rpc(files)
  assert.equal(deletedRetry[0].id, null)
  assert.equal(await count('public.results'), before - 1)
})

test('archives never write results and legacy prefill submissions are not reimported', async () => {
  const before = await count('public.results')
  assert.equal((await rpc([entry('archive', { result: 'https://example.test/results/1' })]))[0].status, 'archive')
  assert.equal(await count('public.results'), before)
  await db.query(`insert into public.results(submitter_id,rig_id,model_id,quant_id,runtime_id,runtime_version,decode_tps,run_date,repo_url)
    values ($1,1,'qwen3-8b','q4_k_m','llamacpp','test',1,'2026-09-04',$2)`, [owner, `https://github.com/${repository}/pull/99`])
  await assert.rejects(rpc([entry('legacy')], { pr: 99 }), /already has a result/)
})

test('browser roles cannot invoke ingestion or inspect private receipts', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`)
    try {
      await assert.rejects(rpc([entry('forged')]), /permission denied/)
      await assert.rejects(db.query('select * from private.pr_result_imports'), /permission denied/)
    } finally { await db.exec('reset role') }
  }
  await db.exec('set role service_role')
  try { assert.equal((await rpc([entry('service')], { dry: true }))[0].status, 'validated') }
  finally { await db.exec('reset role') }
})

test('PR ingestion preserves explicit evidence and submission provenance across retries', async () => {
  const evidenceUrl = 'https://example.com/benchmarks/run.json'
  const files = [entry('with-evidence', { evidenceUrl })]
  const before = await count('public.results')
  assert.equal((await rpc(files, { pr: 101, dry: true }))[0].status, 'validated')
  assert.equal(await count('public.results'), before)
  const [imported] = await rpc(files, { pr: 101 })
  const { rows } = await db.query('select repo_url, source_pr_url from public.results where id = $1', [imported.id])
  assert.deepEqual(rows[0], { repo_url: evidenceUrl, source_pr_url: `https://github.com/${repository}/pull/101` })
  assert.equal((await rpc(files, { pr: 101 }))[0].status, 'already_imported')
  await assert.rejects(rpc([entry('with-evidence', { evidenceUrl: 'https://example.com/changed' })], { pr: 101 }), /already imported/)
  for (const evidenceUrl of ['http://example.com/log', 'javascript:alert(1)', 'https://', 'https://example.com/a b', 'https://user:pass@example.com']) {
    await assert.rejects(rpc([entry('invalid-evidence', { evidenceUrl })], { pr: 102 }), /check constraint/)
  }
  assert.equal(await count('public.results'), before + 1)
})

test('browser writes can omit and clear evidence, and cannot forge submission provenance', async () => {
  // Match the JWT identity of the result owner, while exercising actual column grants and RLS.
  await db.exec(`create or replace function auth.uid() returns uuid language sql as $$ select '${owner}'::uuid $$;
    set role authenticated;`)
  try {
    const { rows } = await db.query(`insert into public.results
      (submitter_id,rig_id,model_id,quant_id,runtime_id,runtime_version,decode_tps,run_date)
      values ($1,1,'qwen3-8b','q4_k_m','llamacpp','optional-evidence',34.2,'2026-09-04')
      returning id, repo_url, source_pr_url`, [owner])
    const { id } = rows[0]
    assert.equal(rows[0].repo_url, null)
    assert.equal(rows[0].source_pr_url, null)
    const changed = await db.query('update public.results set repo_url = $1 where id = $2 returning repo_url', ['https://example.com/report', id])
    assert.equal(changed.rows[0].repo_url, 'https://example.com/report')
    const cleared = await db.query('update public.results set repo_url = null where id = $1 returning repo_url', [id])
    assert.equal(cleared.rows[0].repo_url, null)
    await assert.rejects(db.query('update public.results set source_pr_url = $1 where id = $2', [`https://github.com/${repository}/pull/101`, id]), /permission denied/)
  } finally {
    await db.exec('reset role; create or replace function auth.uid() returns uuid language sql as $$ select null::uuid $$;')
  }
})

test('migration backfills existing PR links without changing evidence, confirmations, or retries', async () => {
  const legacy = await createDatabase(evidenceMigration)
  try {
    await legacy.query(`insert into auth.users(id, raw_user_meta_data) values
      ($1, '{"user_name":"alice"}'), ($2, '{"user_name":"bob"}');`, [owner, other])
    await legacy.query("insert into auth.identities values ('github','123',$1)", [owner])
    await legacy.query("insert into public.rigs(owner_id,name) values ($1,'Alice rig')", [owner])
    const args = [repository, 200, '123', JSON.stringify([entry('before-migration')]), false]
    const query = 'select public.ingest_pr_results($1,$2,$3,$4::jsonb,$5) as result'
    const imported = (await legacy.query(query, args)).rows[0].result[0]
    await legacy.query('insert into public.result_confirmations(result_id,user_id) values ($1,$2)', [imported.id, other])
    const fields = 'repo_url, verification_status, confirmations_count, updated_at'
    const before = (await legacy.query(`select ${fields} from public.results where id = $1`, [imported.id])).rows[0]
    await legacy.exec(readFileSync(new URL(evidenceMigration, migrations), 'utf8'))
    const after = (await legacy.query(`select ${fields}, source_pr_url from public.results where id = $1`, [imported.id])).rows[0]
    const { source_pr_url, ...preserved } = after
    assert.deepEqual(preserved, before)
    assert.equal(source_pr_url, `https://github.com/${repository}/pull/200`)
    assert.equal((await legacy.query('select count(*)::integer as n from public.result_confirmations')).rows[0].n, 1)
    const retry = (await legacy.query(query, args)).rows[0].result[0]
    assert.equal(retry.status, 'already_imported')
    assert.equal(retry.id, imported.id)
  } finally { await legacy.close() }
})

const prFixture = (changes = {}) => ({ number: 50, changed_files: 1, user: { id: 123, login: 'alice', type: 'User' },
  state: 'open', merged: false, merge_commit_sha: 'b'.repeat(40),
  head: { sha: 'a'.repeat(40), repo: { full_name: 'alice/intelinside' } }, base: { ref: 'main', repo: { full_name: repository } }, ...changes })
function githubFixture(pr, { changed, content = raw, onRead } = {}) {
  return async (path) => {
    onRead?.(path)
    if (path.includes('/files?')) return changed ?? [{ filename: 'results/alice/run.json', status: 'added' }]
    if (path.includes('/contents/')) return { type: 'file', encoding: 'base64', size: 100, content: Buffer.from(JSON.stringify(content)).toString('base64') }
    return structuredClone(pr)
  }
}
test('runner validates open PRs, writes only merged PRs, and passes GitHub author ID', async () => {
  for (const merged of [false, true]) {
    const pr = prFixture({ merged, state: merged ? 'closed' : 'open' })
    const reads = [], calls = []
    await processPr({ github: githubFixture(pr, { onRead: (p) => reads.push(p) }), repository, number: 50, defaultBranch: 'main', parseResultFile,
      database: { rpc: async (name, args) => { calls.push({ name, args }); return { data: [] } } } })
    assert.equal(calls.length, 1)
    assert.equal(calls[0].args.p_dry_run, !merged)
    assert.equal(calls[0].args.p_github_id, '123')
    assert.ok(reads.some((p) => p.includes(`/repos/${merged ? repository : 'alice/intelinside'}/contents/`) && p.endsWith(merged ? pr.merge_commit_sha : pr.head.sha)))
  }
})
test('closed-unmerged PRs do not write; bot authors and missing configuration fail', async () => {
  const options = { repository, number: 50, defaultBranch: 'main', parseResultFile, database: { rpc: () => assert.fail('must not write') } }
  await processPr({ ...options, github: githubFixture(prFixture({ state: 'closed' })) })
  await assert.rejects(processPr({ ...options, github: githubFixture(prFixture({ user: { id: 42, login: 'bot', type: 'Bot' } }),
    { changed: [{ filename: 'results/bot/run.json', status: 'added' }] }) }), /Bot-authored/)
  await assert.rejects(processPr({ ...options, database: null, github: githubFixture(prFixture()) }), /Maintainer setup/)
})
test('file collection paginates, ignores deletions, and refuses invalid content', async () => {
  const seen = []
  const github = githubFixture(prFixture(), { onRead: (p) => seen.push(p) })
  const files = await collectFiles(async (path) => {
    if (path.endsWith('page=1')) return Array.from({ length: 100 }, () => ({ filename: 'README.md', status: 'modified' }))
    if (path.endsWith('page=2')) return [{ filename: 'results/alice/deleted.json', status: 'removed' }, { filename: 'results/alice/run.json', status: 'added' }]
    return github(path)
  }, repository, prFixture({ changed_files: 102 }), parseResultFile)
  assert.equal(files.length, 1)
  assert.equal(seen.filter((p) => p.includes('/contents/')).length, 1)
  await assert.rejects(collectFiles(github, repository, prFixture({ changed_files: 3001 }), parseResultFile), /too many/)
  await assert.rejects(collectFiles(async (path) => path.includes('/contents/') ? { type: 'symlink' } : github(path), repository, prFixture(), parseResultFile), /regular JSON/)
})
test('changing PR head during validation prevents ingestion', async () => {
  const pr = prFixture()
  let gets = 0
  const github = githubFixture(pr)
  await assert.rejects(processPr({ repository, number: 50, defaultBranch: 'main', parseResultFile,
    database: { rpc: () => assert.fail('must not write') },
    github: async (path) => {
      if (path === `/repos/${repository}/pulls/50` && ++gets > 1) return { ...pr, head: { ...pr.head, sha: 'c'.repeat(40) } }
      return github(path)
    } }), /changed during validation/)
})

test('unrelated PRs pass without a site account or database configuration', async () => {
  const pr = prFixture({ user: { id: 42, login: 'dependency-bot', type: 'Bot' } })
  const result = await processPr({ repository, number: 50, defaultBranch: 'main', parseResultFile, database: null,
    github: githubFixture(pr, { changed: [{ filename: 'README.md', status: 'modified' }] }) })
  assert.deepEqual(result.lines, ['No result files to import.'])
})
test('malformed result paths and incomplete file lists fail instead of silently skipping runs', async () => {
  await assert.rejects(collectFiles(githubFixture(prFixture(), { changed: [{ filename: 'results/run.json', status: 'added' }] }), repository, prFixture(), parseResultFile), /put the file/)
  await assert.rejects(collectFiles(githubFixture(prFixture()), repository, prFixture({ changed_files: 2 }), parseResultFile), /incomplete/)
})
test('runner and real database integrate for validation, merge and retry', async () => {
  const database = { rpc: async (name, args) => {
    assert.equal(name, 'ingest_pr_results')
    return { data: await rpc(args.p_files, { id: args.p_github_id, pr: args.p_pr_number, dry: args.p_dry_run }) }
  } }
  const options = { repository, number: 50, defaultBranch: 'main', parseResultFile, database }
  const before = await count('public.results')
  await processPr({ ...options, github: githubFixture(prFixture()) })
  assert.equal(await count('public.results'), before)
  const merged = { ...options, github: githubFixture(prFixture({ merged: true, state: 'closed' })) }
  await processPr(merged)
  assert.equal(await count('public.results'), before + 1)
  await processPr(merged)
  assert.equal(await count('public.results'), before + 1)
})
