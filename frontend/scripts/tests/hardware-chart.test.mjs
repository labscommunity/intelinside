import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

let hardwareChart
before(async () => {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL('../../src/lib/api/hardware-chart.ts', import.meta.url))],
    tsconfig: fileURLToPath(new URL('../../tsconfig.json', import.meta.url)),
    bundle: true, write: false, platform: 'browser', format: 'esm',
  })
  ;({ hardwareChart } = await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`
  ))
})

test('B70 chart retains Cascadia alongside faster runtimes using submitted results', async () => {
  const directory = new URL('../../../results/SergiioB/', import.meta.url)
  const submissions = await Promise.all((await readdir(directory))
    .filter((name) => name.endsWith('.json'))
    .map(async (name) => ({ id: name, ...JSON.parse(await readFile(new URL(name, directory), 'utf8')) })))
  const results = submissions.filter((r) => r.component === 'intel-arc-pro-b70').map((r) => ({
    ...r, modelId: r.model, runtimeId: r.runtime,
  }))
  const bars = hardwareChart(results)
  const cascadia = bars.filter((bar) => bar.runtimeId === 'cascadia')
  assert.deepEqual(cascadia.map((bar) => bar.tps), [49.7, 22.7])
  assert.ok(cascadia.every((bar) => bar.label.endsWith(' · Cascadia')))
  assert.ok(cascadia.find((bar) => bar.href === '/results/2026-09-19-qwen3-8-27b-int4-cascadia.json'))
  assert.ok(bars.some((bar) => bar.runtimeId === 'vllm' && bar.tps === 106.7))
  assert.ok(bars.some((bar) => bar.runtimeId === 'openvino-genai' && bar.tps === 95.3))
  assert.ok(bars.length > 10, 'slower runtime winners must not be truncated')
  assert.equal(new Set(bars.map((bar) => bar.label)).size, bars.length)
  assert.deepEqual(bars.map((bar) => bar.tps), bars.map((bar) => bar.tps).sort((a, b) => b - a))
})

test('repeated runs keep the fastest result, breaking ties by earliest run date', () => {
  const base = { modelId: 'unknown-model', quant: 'unknown-quant', runtimeId: 'unknown-runtime' }
  const results = [
    { ...base, id: 'later', decodeTps: 20, runDate: '2026-09-20' },
    { ...base, id: 'slower', decodeTps: 10, runDate: '2026-09-18' },
    { ...base, id: 'earlier', decodeTps: 20, runDate: '2026-09-19' },
  ]
  assert.deepEqual(hardwareChart(results), [{
    label: 'unknown-model unknown-quant · unknown-runtime',
    tps: 20, runtimeId: 'unknown-runtime', href: '/results/earlier',
  }])
  assert.deepEqual(hardwareChart([]), [])
})
