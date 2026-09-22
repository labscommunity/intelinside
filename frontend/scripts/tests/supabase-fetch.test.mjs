import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

let createSupabaseFetch
before(async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../../src/lib/supabase-fetch.ts', import.meta.url))],
    bundle: true, write: false, platform: 'browser', format: 'esm',
  })
  ;({ createSupabaseFetch } = await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`
  ))
})

const origin = 'https://test.supabase.invalid'
const url = `${origin}/rest/v1/profiles?select=*`
const future = { code: 'PGRST303', message: 'JWT issued at future' }
const rejection = () => Response.json(future, { status: 401 })

test('first-load rejection recovers with the same request and credentials', async () => {
  const calls = [], delays = []
  const init = { headers: { authorization: 'Bearer test-token' } }
  const fetch = createSupabaseFetch(origin, async (...args) => {
    calls.push(args)
    return calls.length === 1 ? rejection() : Response.json([{ id: '1' }])
  }, async (ms) => { delays.push(ms) })
  assert.deepEqual(await (await fetch(url, init)).json(), [{ id: '1' }])
  assert.deepEqual(calls, [[url, init], [url, init]])
  assert.deepEqual(delays, [250])
})

test('persistent failures stop after three retries and retain the error body', async () => {
  let calls = 0
  const delays = []
  const fetch = createSupabaseFetch(origin, async () => { calls++; return rejection() }, async (ms) => { delays.push(ms) })
  const response = await fetch(url)
  assert.equal(calls, 4)
  assert.deepEqual(delays, [250, 750, 1500])
  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), future)
})

test('other errors, writes, auth calls, and unrelated origins are not retried', async () => {
  for (const [target, init, response] of [
    [url, {}, Response.json({ code: 'PGRST303', message: 'JWT expired' }, { status: 401 })],
    [url, {}, Response.json({ ...future, code: 'other' }, { status: 401 })],
    [url, {}, Response.json(future, { status: 500 })],
    [url, {}, new Response('not JSON', { status: 401 })],
    ...['POST', 'PATCH', 'DELETE'].map((method) => [url, { method }, rejection()]),
    [`${origin}/auth/v1/user`, {}, rejection()],
    ['https://other.invalid/rest/v1/profiles', {}, rejection()],
  ]) {
    let calls = 0
    const fetch = createSupabaseFetch(origin, async () => { calls++; return response }, async () => assert.fail('Unexpected retry'))
    assert.equal(await fetch(target, init), response)
    assert.equal(calls, 1)
    assert.ok(await response.text())
  }
})

test('aborting during the retry delay prevents another request', async () => {
  const controller = new AbortController()
  let calls = 0
  const fetch = createSupabaseFetch(origin, async () => { calls++; return rejection() }, async () => controller.abort())
  await assert.rejects(fetch(new Request(url, { signal: controller.signal })), { name: 'AbortError' })
  assert.equal(calls, 1)
})

test('network failures are passed through without retrying', async () => {
  const error = new TypeError('Network failed')
  const fetch = createSupabaseFetch(origin, async () => { throw error }, async () => assert.fail('Unexpected retry'))
  await assert.rejects(fetch(url), (caught) => caught === error)
})
