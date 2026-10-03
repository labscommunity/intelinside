// Renders the card layouts with sample data to PNGs, so they can be checked without a deploy. Bundled and run by
// scripts/og-preview.mjs (`npm run og:preview [outDir]`). Sample values mirror the Figma frames. Besides the two
// layouts it writes one result card per runtime in the catalog, so every runtime's mark can be checked, and a
// magnified lockup with guide lines at the wordmark's intended cap height and baseline.
import fs from 'node:fs'
import path from 'node:path'
import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'
import { loadCardAssets, loadFonts, runtimeLogoAsset, type AssetSource } from '../src/og/assets.js'
import { ResultCardImage, RigCardImage } from '../src/og/cards.js'
import type { ResultCardData, RigCardData } from '../src/og/data.js'
import { cardParts } from '../src/og/data.js'
import { RUNTIMES } from '../src/catalog/index.js'

const root = path.resolve(process.cwd())
const outDir = path.resolve(process.argv[2] ?? '.og-preview')
fs.mkdirSync(outDir, { recursive: true })

const disk: AssetSource = {
  binary: async (file) => {
    const bytes = fs.readFileSync(path.join(root, 'public', 'og', file))
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  },
  text: async (file) => fs.readFileSync(path.join(root, 'public', 'og', file), 'utf8'),
}

const owner = { handle: 'tatef', initials: 'TB' }

const cascadia = RUNTIMES.find((r) => r.id === 'cascadia')!

const result: ResultCardData = {
  id: '1042',
  decodeTps: 84.6,
  model: 'Qwen3-8B',
  quant: 'INT4',
  runtime: cascadia.name,
  runtimeId: cascadia.id,
  runtimeLogo: cascadia.logoUrl || undefined,
  runtimeColor: cascadia.color,
  runtimeVersion: '0.9.2',
  hardware: '1× Intel Arc Pro B70',
  inRig: 'Quad B70 workstation',
  verified: true,
  rank: { position: 3, size: 41, kind: 'components' },
  owner,
  runDate: '2026-09-02',
  updatedAt: '2026-09-02T18:00:00Z',
}

const rig: RigCardData = {
  id: '12',
  name: 'Quad B70 workstation',
  os: 'Ubuntu 24.04',
  parts: [
    { quantity: 1, name: 'Intel Core Ultra 9 285K' },
    { quantity: 4, name: 'Intel Arc Pro B70', detail: '32 GB' },
    { quantity: 4, name: 'DDR5-6000 32 GB' },
  ],
  components: [
    { hardwareId: 'intel-core-ultra-9-285k', quantity: 1 },
    { hardwareId: 'intel-arc-pro-b70', quantity: 4 },
    { hardwareId: 'ddr5-6000-32gb', quantity: 4 },
  ],
  best: { tps: 84.6, model: 'Qwen3-8B', quant: 'INT4', runtime: 'Cascadia' },
  resultsCount: 12,
  owner,
  updatedAt: '2026-09-02T18:00:00Z',
}

/** A stand-in photo: a dark panel rendered to PNG, since real uploads are JPEG or PNG. */
function samplePhoto(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="680"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a2a33"/><stop offset="1" stop-color="#121216"/></linearGradient></defs><rect width="960" height="680" fill="url(#g)"/><rect x="120" y="200" width="720" height="280" rx="24" fill="#1c1c22" stroke="#3a3a44" stroke-width="3"/><rect x="120" y="200" width="720" height="14" rx="7" fill="#5438ff"/><circle cx="330" cy="340" r="104" fill="#121215" stroke="#3a3a44" stroke-width="3"/><circle cx="630" cy="340" r="104" fill="#121215" stroke="#3a3a44" stroke-width="3"/></svg>`
  const png = new Resvg(svg).render().asPng()
  return `data:image/png;base64,${Buffer.from(png).toString('base64')}`
}

type Fonts = Awaited<ReturnType<typeof loadFonts>>

async function write(name: string, element: Parameters<typeof satori>[0], fonts: Fonts, size = { width: 1200, height: 630 }, scale = 1) {
  const svg = await satori(element, { ...size, fonts })
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size.width * scale } }).render().asPng()
  const file = path.join(outDir, `${name}.png`)
  fs.writeFileSync(file, png)
  console.log(`wrote ${path.relative(root, file)}`)
}

const fonts = await loadFonts(disk)
const resultAssets = await loadCardAssets(disk, 'dots-result.svg', { runtimeLogo: runtimeLogoAsset(result.runtimeLogo) })
const rigAssets = await loadCardAssets(disk, 'dots-side.svg')

await write('result', <ResultCardImage data={result} assets={resultAssets} />, fonts)
await write('rig', <RigCardImage data={rig} assets={{ ...rigAssets, photo: samplePhoto() }} />, fonts)
await write('rig-no-photo', <RigCardImage data={rig} assets={rigAssets} />, fonts)
const fleetComponents = ['intel-core-ultra-x7-358h', 'intel-arc-b390', 'intel-ai-boost-npu-5', 'ddr5-4800-64gb-ecc']
  .map((hardwareId) => ({ hardwareId, quantity: 11 }))
await write('rig-panther-lake-fleet', <RigCardImage data={{
  ...rig, id: '8', name: 'Panther Lake Lab', best: undefined, resultsCount: 0,
  owner: { handle: 't8', initials: 'TB' }, components: fleetComponents,
  parts: cardParts(fleetComponents.map((c) => ({ hardware_id: c.hardwareId, quantity: c.quantity }))),
}} assets={rigAssets} />, fonts)
await write(
  'result-long',
  <ResultCardImage data={{ ...result, model: 'Llama 3.1 8B Instruct', quant: 'Q4_K_M', runtime: 'OpenVINO GenAI', runtimeId: 'openvino-genai', runtimeLogo: undefined, runtimeVersion: '2026.1.0', hardware: 'NUC charlie', inRig: undefined, verified: false, rank: { position: 17, size: 41, kind: 'rigs' } }} assets={{ ...resultAssets, runtimeLogo: undefined }} />,
  fonts,
)
// Real build strings people submit: a dev version with a hash and a kernels suffix (result 43), one with no spaces
// to break, and one too long for two lines.
const vllm = RUNTIMES.find((r) => r.id === 'vllm')!
const vllmAssets = await loadCardAssets(disk, 'dots-result.svg', { runtimeLogo: runtimeLogoAsset(vllm.logoUrl || undefined) })
const onVllm = { ...result, decodeTps: 171, model: 'Qwen3.6-35B-A3B', runtime: vllm.name, runtimeId: vllm.id, runtimeLogo: vllm.logoUrl || undefined, runtimeColor: vllm.color, hardware: '1× Intel Arc Pro B70', inRig: 'Desktop Workstation', rank: { position: 1, size: 1, kind: 'components' as const }, owner: { handle: 'sergiiob', initials: 'SE' } }
await write('result-version-long', <ResultCardImage data={{ ...onVllm, runtimeVersion: '0.26.1rc1.dev457+gc810e5ee9.xpu (vllm-xpu-kernels 0.1.11)' }} assets={vllmAssets} />, fonts)
await write('result-version-nospace', <ResultCardImage data={{ ...onVllm, runtimeVersion: '0.26.1rc1.dev457+gc810e5ee9.xpu+vllm-xpu-kernels-0.1.11+oneapi-2026.1.0-ubuntu24' }} assets={vllmAssets} />, fonts)
await write('result-version-overlong', <ResultCardImage data={{ ...onVllm, runtimeVersion: 'build 0.26.1rc1.dev457+gc810e5ee9.xpu with vllm-xpu-kernels 0.1.11, oneAPI 2026.1.0, Level Zero 1.21, PyTorch 2.9.0+xpu on Ubuntu 24.04 LTS kernel 6.14' }} assets={vllmAssets} />, fonts)
// Rig 1 on production: a long best line beside the photo.
await write('rig-best-long', <RigCardImage data={{ ...rig, name: 'Desktop Workstation', os: 'Ubuntu 26.04', parts: [{ quantity: 2, name: 'Intel Arc Pro B70', detail: '32 GB' }], components: [{ hardwareId: 'intel-arc-pro-b70', quantity: 2 }], best: { tps: 187, model: 'Nemotron 3.5 Lightning 30B A3B', quant: 'GPTQ 4-bit', runtime: 'vLLM' }, resultsCount: 8, owner: { handle: 'sergiiob', initials: 'SE' } }} assets={{ ...rigAssets, photo: samplePhoto() }} />, fonts)
await write('rig-no-photo-single', <RigCardImage data={{ ...rig, name: 'Intel arc B580', os: '', parts: [{ quantity: 1, name: 'Intel Arc B580', detail: '12 GB' }], components: [{ hardwareId: 'intel-arc-b580', quantity: 1 }], best: undefined, resultsCount: 0 }} assets={rigAssets} />, fonts)
await write('rig-no-photo-dual', <RigCardImage data={{ ...rig, name: 'Maxsun ARC Pro B60 Dual 48G Turbo', parts: [{ quantity: 1, name: 'Intel Core i7-14700K' }, { quantity: 2, name: 'Intel Arc Pro B60', detail: '24 GB' }], components: [{ hardwareId: 'intel-core-i7-14700k', quantity: 1 }, { hardwareId: 'intel-arc-pro-b60', quantity: 2 }], best: { tps: 15.3, model: 'Qwen3.8-27B', quant: 'Q4_K_M', runtime: 'llama.cpp' }, resultsCount: 2 }} assets={rigAssets} />, fonts)
await write('rig-long', <RigCardImage data={{ ...rig, name: 'The absurdly long name of a workstation that never ends', best: undefined, resultsCount: 0 }} assets={rigAssets} />, fonts)

// One result card per runtime, so every mark can be checked against the leaderboard's.
for (const runtime of RUNTIMES) {
  const assets = await loadCardAssets(disk, 'dots-result.svg', { runtimeLogo: runtimeLogoAsset(runtime.logoUrl || undefined) })
  const data: ResultCardData = { ...result, runtime: runtime.name, runtimeId: runtime.id, runtimeLogo: runtime.logoUrl || undefined, runtimeColor: runtime.color }
  await write(`result-${runtime.id}`, <ResultCardImage data={data} assets={assets} />, fonts)
}

// The lockup at 3×, with guides where the template's wordmark had its cap top (y=12.5) and baseline (y=48).
const guide = (top: number) => <div style={{ position: 'absolute', left: 0, top, width: 520, height: 1, backgroundColor: '#ff3b6b' }} />
await write(
  'lockup-check',
  <div style={{ display: 'flex', position: 'relative', width: 520, height: 60, backgroundColor: '#0a0a0a' }}>
    <div style={{ display: 'flex', position: 'absolute', left: 0, top: 0, height: 60, alignItems: 'flex-end' }}>
      <img src={resultAssets.mark} width={71} height={60} />
      <span style={{ marginLeft: 14, fontFamily: 'Red Hat Display', fontWeight: 700, fontSize: 49, lineHeight: '49px', paddingBottom: 1, color: '#f4f4f5' }}>Intelinside.ai</span>
    </div>
    {guide(12.5)}
    {guide(48)}
  </div>,
  fonts,
  { width: 520, height: 60 },
  3,
)
