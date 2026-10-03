import { test, before, after, mock } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

let rigSummaryLine, drawRig, HARDWARE_BY_ID, supabaseApi, supabase
before(async () => {
  mock.method(globalThis, 'fetch', () => assert.fail('Unexpected HTTP request'))
  const bundle = await build({
    stdin: {
      contents: `export { rigSummaryLine } from './lib/rig-summary';
        export { drawRig } from './lib/schematic';
        export { HARDWARE_BY_ID } from './catalog';
        export { supabaseApi } from './lib/api/supabase';
        export { supabase } from './lib/auth';`,
      resolveDir: fileURLToPath(new URL('../../src', import.meta.url)),
    },
    alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) },
    define: { 'import.meta.env': JSON.stringify({
      VITE_SUPABASE_URL: 'https://rig-test.supabase.invalid',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_rig_test',
    }) },
    bundle: true, write: false, platform: 'browser', format: 'esm', logLevel: 'silent',
  })
  ;({ rigSummaryLine, drawRig, HARDWARE_BY_ID, supabaseApi, supabase } = await import(
    `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`
  ))
  await supabase.auth.getSession()
  await supabase.auth.stopAutoRefresh()
})
after(() => mock.restoreAll())

const part = (hardwareId, quantity = 1) => ({ hardwareId, quantity })
const panther = [part('intel-core-ultra-x7-358h', 11), part('intel-arc-b390', 11), part('intel-ai-boost-npu-5', 11), part('ddr5-4800-64gb-ecc', 11)]
const description = '11× Core Ultra X7 358H · 11× Arc B390 · 704 GB DDR5'

test('saved rig details and listing describe all eleven Panther Lake packages', async (t) => {
  const rig = { id: 8, owner_id: 'owner', name: 'Panther Lake Lab', os: 'Ubuntu 24.04', photo_path: null,
    notes: null, created_at: '2026-09-27', updated_at: '2026-09-27' }
  t.mock.method(globalThis, 'fetch', async (url) => {
    const parsed = new URL(url)
    assert.equal(parsed.origin, 'https://rig-test.supabase.invalid')
    const tables = {
      rigs: [rig],
      rig_components: panther.map((c) => ({ rig_id: 8, hardware_id: c.hardwareId, quantity: c.quantity })),
    }
    return Response.json(tables[parsed.pathname.split('/').at(-1)] ?? [])
  })
  assert.equal((await supabaseApi.rig('8')).summary, description)
  assert.equal((await supabaseApi.rigs({})).items[0].summary, description)
})

test('summaries keep single-package and discrete-GPU formatting and sum RAM quantities', () => {
  assert.equal(rigSummaryLine(panther), description)
  assert.equal(rigSummaryLine(panther.map((p) => ({ ...p, quantity: 1 }))), 'Core Ultra X7 358H · Arc B390 · 64 GB DDR5')
  assert.equal(rigSummaryLine([...panther, part('intel-arc-pro-b70', 2), part('ddr5-6000-32gb', 2)]),
    '11× Core Ultra X7 358H · 2× Arc Pro B70 · 768 GB DDR5')
  assert.equal(rigSummaryLine([part('intel-arc-pro-b70')]), '1× Arc Pro B70')
  assert.equal(rigSummaryLine([part('unknown-part')]), '')
})

test('mixed CPU models and their integrated graphics are retained in the summary', () => {
  assert.equal(rigSummaryLine([part('intel-core-ultra-x7-358h', 11), part('intel-core-ultra-9-288v', 2),
    part('intel-arc-b390', 11), part('intel-arc-140v', 2)]),
  '11× Core Ultra X7 358H · 2× Core Ultra 9 288V · 11× Arc B390 · 2× Arc 140V')
})

test('CPU schematics show multiple packages and the full fleet count without clipping', () => {
  for (const quantity of [1, 2, 4, 11, 64]) {
    const drawing = drawRig([part('intel-core-ultra-x7-358h', quantity)], HARDWARE_BY_ID)
    const labels = drawing.prims.filter((p) => p.kind === 'text').map((p) => p.text)
    assert.equal(labels.filter((text) => text === '358H').length, Math.min(quantity, 4))
    assert.deepEqual(labels.filter((text) => text.startsWith('×')), quantity > 4 ? [`×${quantity}`] : [])
    const [, , width, height] = drawing.viewBox.split(' ').map(Number)
    for (const p of drawing.prims) {
      if (p.kind === 'rect') assert.ok(p.x >= 0 && p.y >= 0 && p.x + p.w <= width && p.y + p.h <= height)
      if (p.kind === 'text') assert.ok(p.x > 0 && p.x < width && p.y - p.size > 0 && p.y < height)
    }
  }
  const fleet = drawRig(panther, HARDWARE_BY_ID)
  assert.equal(fleet.prims.filter((p) => p.kind === 'text' && p.text === '×11').length, 2, 'CPU and memory quantities must both appear')
  assert.deepEqual(fleet, drawRig(panther.filter((p) => !['intel-arc-b390', 'intel-ai-boost-npu-5'].includes(p.hardwareId)), HARDWARE_BY_ID),
    'integrated graphics and NPU are carried by the CPU packages')
})

test('schematic retains every CPU model in a mixed rig', () => {
  const { prims } = drawRig([part('intel-core-ultra-x7-358h', 11), part('intel-core-ultra-9-288v', 2)], HARDWARE_BY_ID)
  const labels = prims.filter((p) => p.kind === 'text').map((p) => p.text)
  assert.ok(labels.includes('×11'))
  assert.equal(labels.filter((text) => text === '358H').length, 4)
  assert.equal(labels.filter((text) => text === '288V').length, 2)
})
