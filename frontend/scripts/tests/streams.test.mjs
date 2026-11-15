import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

// Decode rate against concurrent requests (issue #130): totals and per-request rates are separate curves, a single
// request seeds both, and nothing is drawn from a setup measured at only one request count.
let streamSeries, isTotalThroughput, SETUP_BY_ID, setupOf
before(async () => {
  const bundle = await build({
    stdin: {
      contents: `export { streamSeries } from './lib/streams'; export { isTotalThroughput, SETUP_BY_ID, setupOf } from './lib/setups';`,
      resolveDir: fileURLToPath(new URL('../../src', import.meta.url)),
    },
    alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) },
    bundle: true, write: false, platform: 'browser', format: 'esm', logLevel: 'silent',
  })
  ;({ streamSeries, isTotalThroughput, SETUP_BY_ID, setupOf } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`))
})

const result = (id, concurrency, decodeTps, extra = {}) => ({
  id: String(id), rigId: '1', modelId: 'qwen3-8b', quant: 'int4', runtimeId: 'openvino-genai', runtimeVersion: 'x', execution: 'stock',
  decodeTps, runDate: '2026-11-13', concurrency, moderation: { hidden: false }, verification: { status: 'self_reported', confirmations: 0 },
  createdAt: '', updatedAt: '', ...extra,
})

test('a single request seeds both curves and totals and per-request rates stay apart', () => {
  const series = streamSeries([
    result(1, 1, 18.5),
    result(2, 8, 136, { decodeScope: 'total' }),
    result(3, 48, 227.5, { decodeScope: 'total' }),
    result(4, 8, 17, { decodeScope: 'per_request' }),
    result(5, 4, 12, { decodeScope: 'per_request' }),
  ])
  assert.deepEqual(series.map((s) => [s.scope, s.points.map((p) => [p.concurrency, p.decodeTps])]), [
    ['per_request', [[1, 18.5], [4, 12], [8, 17]]],
    ['total', [[1, 18.5], [8, 136], [48, 227.5]]],
  ])
  assert.equal(series[0].label, 'Qwen3-8B INT4')
})

test('one request count is not a curve; repeats at a count keep the best; legacy batch size and hidden results are ignored', () => {
  assert.deepEqual(streamSeries([result(1, 1, 18.5), result(2, 1, 19.0)]), [])
  assert.deepEqual(streamSeries([result(1, 1, 18.5), result(2, 8, 100, { decodeScope: 'total' }), result(3, 8, 130, { decodeScope: 'total' })]).map((s) => s.points.map((p) => [p.concurrency, p.decodeTps, p.resultId])), [[[1, 18.5, '1'], [8, 130, '3']]])
  assert.deepEqual(streamSeries([result(1, 1, 18.5), result(2, undefined, 100, { batchSize: 8 })]), [])
  assert.deepEqual(streamSeries([result(1, 1, 18.5), result(2, 8, 100, { decodeScope: 'total', moderation: { hidden: true } })]), [])
  // A total at several requests with no decodeScope recorded is ambiguous and stays out.
  assert.deepEqual(streamSeries([result(1, 1, 18.5), result(2, 8, 100)]), [])
})

test('setups are keyed by model, quant, runtime, build and part', () => {
  const series = streamSeries([
    result(1, 1, 18.5), result(2, 8, 136, { decodeScope: 'total' }),
    result(3, 1, 20, { runtimeId: 'cascadia' }), result(4, 8, 150, { runtimeId: 'cascadia', decodeScope: 'total' }),
    result(5, 1, 9, { componentId: 'intel-core-ultra-x7-358h', componentQuantity: 1, component: { name: 'Core Ultra X7 358H' } }),
    result(6, 8, 40, { componentId: 'intel-core-ultra-x7-358h', componentQuantity: 1, component: { name: 'Core Ultra X7 358H' }, decodeScope: 'total' }),
  ])
  assert.deepEqual(series.map((s) => [s.scope, s.runtimeId, s.label]), [
    ['total', 'cascadia', 'Qwen3-8B INT4'],
    ['total', 'openvino-genai', 'Qwen3-8B INT4'],
    ['total', 'openvino-genai', 'Qwen3-8B INT4 · 1× Core Ultra X7 358H'],
  ])
})

test('the Throughput setup takes totals across requests and nothing else', () => {
  assert.equal(isTotalThroughput({ concurrency: 8, decodeScope: 'total' }), true)
  assert.equal(isTotalThroughput({ concurrency: 1 }), false)
  assert.equal(isTotalThroughput({ concurrency: 8, decodeScope: 'per_request' }), false)
  assert.equal(isTotalThroughput({ concurrency: 8 }), false)
  assert.equal(setupOf({ concurrency: 144, decodeScope: 'total', decodeMethod: 'wall' })?.id, 'throughput')
  assert.equal(SETUP_BY_ID.throughput.match({ concurrency: 4, decodeScope: 'per_request', inputTokens: 512, decodeMethod: 'streamed' }), false)
  assert.equal(setupOf({ concurrency: 4, decodeScope: 'per_request', inputTokens: 512, decodeMethod: 'streamed' })?.id, 'concurrent')
})
