import type { CustomRuntime, FlagReason, HardwareType, Result, Rig, User } from '@/lib/api/types'
import { HARDWARE_BY_ID, MODEL_BY_ID, RUNTIMES } from '@/catalog'
import { rigSummaryLine } from '@/lib/rig-summary'

// Deterministic seed so the same rigs and numbers show up on every reload.

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Grounds for white initials, all above 6:1.
const AVATAR_COLORS = ['#52509b', '#8c4400', '#006f57', '#8a3a64', '#44670d', '#006394', '#705800', '#92393e', '#6f458c', '#006e42']

export function avatarDataUri(handle: string, color: string): string {
  const initials = handle.slice(0, 2).toUpperCase()
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="48" fill="${color}"/><text x="48" y="58" font-family="Red Hat Text Variable, system-ui, sans-serif" font-size="36" font-weight="600" fill="#fff" text-anchor="middle">${initials}</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const USER_SEED: { handle: string; name: string; bio: string }[] = [
  { handle: 'tatef', name: 'Tate Berenbaum', bio: 'Runs the quad B70 box. Cascadia maintainer.' },
  { handle: 'jacksmith', name: 'Jack Smith', bio: 'NUC fleet wrangler. Panther Lake enjoyer.' },
  { handle: 'horacechoi', name: 'Horace Choi', bio: 'Design. Occasionally benchmarks the desk PC.' },
  { handle: 'nucwrangler', name: 'Priya Natarajan', bio: 'Small boxes, big models.' },
  { handle: 'arcpilot', name: 'Sam Okafor', bio: 'Battlemage since day one.' },
  { handle: 'xeonbench', name: 'Lena Fischer', bio: 'CPU-only inference on far too many cores.' },
  { handle: 'lunarlaker', name: 'Diego Ruiz', bio: 'Laptop benchmarks on battery and on wall.' },
  { handle: 'quantqueen', name: 'Mei Tanaka', bio: 'Every quant, every runtime, one spreadsheet.' },
  { handle: 'bgpu', name: 'Ravi Menon', bio: 'Green cards for comparison. Blue cards for fun.' },
  { handle: 'pantherlake', name: 'Ada Kowalski', bio: 'Dev kit reviewer. Xe3 curious.' },
]

type RigSeed = { id: string; owner: string; name: string; os: string; notes?: string; photo?: boolean; components: [string, number][] }

/** A stand-in rig photo, so the photo layouts (cards, the rig page, its lightbox) are reachable in mock mode. */
function photoDataUri(): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a2a33"/><stop offset="1" stop-color="#121216"/></linearGradient></defs><rect width="1600" height="1000" fill="url(#g)"/><rect x="200" y="290" width="1200" height="420" rx="32" fill="#1c1c22" stroke="#3a3a44" stroke-width="4"/><rect x="200" y="290" width="1200" height="20" rx="10" fill="#5438ff"/><circle cx="550" cy="500" r="150" fill="#121215" stroke="#3a3a44" stroke-width="4"/><circle cx="1050" cy="500" r="150" fill="#121215" stroke="#3a3a44" stroke-width="4"/></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

const RIG_SEED: RigSeed[] = [
  { id: 'rig-quad-b70', owner: 'tatef', name: 'Quad B70 workstation', os: 'Ubuntu 24.04', notes: 'Four Arc Pro B70s on a 285K. Most runs use one card unless noted.', photo: true, components: [['intel-core-ultra-9-285k', 1], ['intel-graphics-arrow-lake-s', 1], ['intel-ai-boost-arrow-lake', 1], ['intel-arc-pro-b70', 4], ['ddr5-6000-32gb', 4]] },
  { id: 'rig-nuc-charlie', owner: 'jacksmith', name: 'NUC charlie', os: 'Windows 11', notes: 'Panther Lake NUC. iGPU runs via OpenVINO unless noted.', components: [['intel-core-ultra-x7-358h', 1], ['intel-arc-b390', 1], ['intel-ai-boost-npu-5', 1], ['ddr5-5600-16gb-sodimm', 2]] },
  { id: 'rig-lunar-ultrabook', owner: 'lunarlaker', name: 'Lunar Lake ultrabook', os: 'Windows 11', notes: 'Plugged in, performance mode.', components: [['intel-core-ultra-9-288v', 1], ['intel-arc-140v', 1], ['intel-ai-boost-npu-4', 1], ['lpddr5x-8533-16gb', 2]] },
  { id: 'rig-b580-gaming', owner: 'arcpilot', name: 'B580 gaming box', os: 'Windows 11', components: [['intel-core-i7-14700k', 1], ['intel-uhd-770', 1], ['intel-arc-b580', 1], ['ddr5-6000-32gb', 2]] },
  { id: 'rig-a770-budget', owner: 'nucwrangler', name: 'A770 budget node', os: 'Ubuntu 24.04', notes: 'Second-hand A770, resizable BAR on.', components: [['intel-core-ultra-5-245k', 1], ['intel-graphics-arrow-lake-s', 1], ['intel-ai-boost-arrow-lake', 1], ['intel-arc-a770-16gb', 1], ['ddr5-5600-32gb', 2]] },
  { id: 'rig-xeon-w7-lab', owner: 'xeonbench', name: 'Xeon w7 lab', os: 'Ubuntu 22.04', components: [['intel-xeon-w7-3465x', 1], ['intel-arc-pro-b60', 2], ['ddr5-4800-64gb-ecc', 8]] },
  { id: 'rig-granite-cpu', owner: 'xeonbench', name: 'Granite Rapids CPU-only', os: 'Ubuntu 24.04', notes: 'No accelerator. AMX on.', components: [['intel-xeon-6-6960p', 1], ['ddr5-4800-64gb-ecc', 8]] },
  { id: 'rig-meteor-laptop', owner: 'quantqueen', name: 'Meteor Lake laptop', os: 'Fedora 42', components: [['intel-core-ultra-7-155h', 1], ['intel-arc-graphics-meteor-lake', 1], ['intel-ai-boost-npu-3', 1], ['ddr5-5600-16gb-sodimm', 2]] },
  { id: 'rig-4090-285k', owner: 'bgpu', name: 'RTX 4090 + 285K', os: 'Windows 11', components: [['intel-core-ultra-9-285k', 1], ['intel-graphics-arrow-lake-s', 1], ['intel-ai-boost-arrow-lake', 1], ['nvidia-geforce-rtx-4090', 1], ['ddr5-6000-32gb', 2]] },
  { id: 'rig-5090', owner: 'bgpu', name: '5090 rig', os: 'Ubuntu 24.04', components: [['amd-ryzen-9-9950x', 1], ['nvidia-geforce-rtx-5090', 1], ['ddr5-6000-32gb', 2]] },
  { id: 'rig-mac-studio', owner: 'quantqueen', name: 'Mac Studio M4 Max', os: 'macOS 15', components: [['apple-m4-max', 1], ['apple-m4-max-gpu-40c', 1], ['lpddr5x-8533-128gb-unified', 1]] },
  { id: 'rig-panther-devkit', owner: 'pantherlake', name: 'Panther Lake dev kit', os: 'Ubuntu 24.04', components: [['intel-core-ultra-x7-358h', 1], ['intel-arc-b390', 1], ['intel-ai-boost-npu-5', 1], ['ddr5-5600-32gb', 2]] },
  { id: 'rig-dual-b580', owner: 'arcpilot', name: 'Dual B580', os: 'Ubuntu 24.04', notes: 'Two B580s for pipeline-parallel tests. The 265K itself gets tested too: cores, iGPU, and NPU each as their own part.', components: [['intel-core-ultra-7-265k', 1], ['intel-graphics-arrow-lake-s', 1], ['intel-ai-boost-arrow-lake', 1], ['intel-arc-b580', 2], ['ddr5-6000-32gb', 2]] },
  { id: 'rig-gaudi3', owner: 'tatef', name: 'Gaudi 3 node', os: 'Ubuntu 24.04', components: [['intel-xeon-6-6960p', 1], ['intel-gaudi-3', 1], ['ddr5-4800-64gb-ecc', 8]] },
  { id: 'rig-horace-desk', owner: 'horacechoi', name: "Horace's desk", os: 'Windows 11', components: [['intel-core-i9-14900k', 1], ['intel-uhd-770', 1], ['nvidia-geforce-rtx-3090', 1], ['ddr5-5600-32gb', 2]] },
]

// Decode tok/s for an 8B model at 4-bit on one unit of the part. Everything else scales from here.
const BASE_TPS: Record<string, number> = {
  'intel-arc-pro-b70': 48, 'intel-arc-pro-b60': 40, 'intel-arc-pro-b50': 30, 'intel-arc-b580': 34, 'intel-arc-b570': 29,
  'intel-arc-a770-16gb': 26, 'intel-arc-a750': 22, 'intel-gaudi-3': 95,
  'nvidia-geforce-rtx-5090': 165, 'nvidia-geforce-rtx-4090': 120, 'nvidia-geforce-rtx-3090': 85, 'nvidia-rtx-pro-6000-blackwell': 175,
  'amd-radeon-rx-7900-xtx': 90,
  'intel-arc-140v': 15, 'intel-arc-140t': 13, 'intel-arc-graphics-meteor-lake': 10, 'intel-uhd-770': 5, 'intel-graphics-arrow-lake-s': 4.5, 'intel-arc-b390': 22, 'apple-m4-max-gpu-40c': 62,
  'intel-core-ultra-9-285k': 11, 'intel-core-ultra-7-265k': 10, 'intel-core-ultra-5-245k': 8.5, 'intel-core-ultra-9-288v': 7.5, 'intel-core-ultra-7-258v': 7,
  'intel-core-ultra-7-155h': 6.5, 'intel-core-ultra-x7-358h': 9, 'intel-core-i9-14900k': 9.5, 'intel-core-i7-14700k': 8.8, 'intel-xeon-w7-3465x': 14,
  'intel-xeon-6-6960p': 24, 'amd-ryzen-9-9950x': 12, 'amd-ryzen-7-9800x3d': 9, 'apple-m4-max': 18,
  'intel-ai-boost-npu-3': 5, 'intel-ai-boost-npu-4': 9, 'intel-ai-boost-npu-5': 11, 'intel-ai-boost-arrow-lake': 5.5,
}
const MODEL_FACTOR: Record<string, number> = { 'qwen3-8b': 1, 'llama-3-1-8b': 1, 'qwen3-30b-a3b': 0.85, 'gemma-3-12b': 0.65 }
const QUANT_FACTOR: Record<string, number> = { int4: 1, q4_k_m: 0.97, q8_0: 0.62, fp16: 0.36 }
const RUNTIME_FACTOR: Record<string, Record<string, number>> = {
  Intel: { cascadia: 1.15, 'openvino-genai': 1.05, 'ipex-llm': 1.0, llamacpp: 0.9, ollama: 0.85, vllm: 0.95, pytorch: 0.55 },
  NVIDIA: { vllm: 1.1, llamacpp: 0.95, ollama: 0.9, cascadia: 0.9, pytorch: 0.6, 'openvino-genai': 0.7 },
  AMD: { llamacpp: 0.9, vllm: 0.95, ollama: 0.85, cascadia: 0.8, pytorch: 0.5 },
  Apple: { llamacpp: 1.0, ollama: 0.95, cascadia: 0.85, pytorch: 0.5 },
}
const RUNTIME_VERSIONS: Record<string, string[]> = {
  cascadia: ['0.9.2', '0.9.4', '0.10.0'], pytorch: ['2.7.1', '2.8.0'], vllm: ['0.10.2', '0.11.0'], llamacpp: ['b6210', '6400', 'b6512'],
  ollama: ['0.11.8', '0.12.1'], 'openvino-genai': ['2025.3.0', '2026.1.0'], 'ipex-llm': ['2.2.0', '2.3.0'],
}
const ACCEL_TYPES: HardwareType[] = ['gpu', 'igpu', 'npu', 'cpu']

export type SeedDb = {
  users: User[]
  rigs: Rig[]
  customRuntimes: CustomRuntime[]
  results: Result[]
  confirmations: Map<string, Set<string>> // resultId -> userIds
  flags: Map<string, Map<string, FlagReason>> // resultId -> userId -> reason
}

export function createSeed(): SeedDb {
  const rand = mulberry32(20260902)
  const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]
  const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString()

  const users: User[] = USER_SEED.map((u, i) => ({
    id: `u${i + 1}`,
    handle: u.handle,
    name: u.name,
    bio: u.bio,
    avatarUrl: avatarDataUri(u.handle, AVATAR_COLORS[i % AVATAR_COLORS.length]),
    createdAt: daysAgo(120 - i * 7),
  }))
  const userByHandle = Object.fromEntries(users.map((u) => [u.handle, u]))

  const rigs: Rig[] = RIG_SEED.map((r, i) => {
    const components = r.components.map(([hardwareId, quantity]) => ({ hardwareId, quantity }))
    const created = daysAgo(90 - i * 4)
    return {
      id: r.id, ownerId: userByHandle[r.owner].id, name: r.name, os: r.os, notes: r.notes, photoUrl: r.photo ? photoDataUri() : undefined,
      components, summary: rigSummaryLine(components), createdAt: created, updatedAt: created,
    }
  })

  // Custom runtimes people have registered. Kept small: at launch there will be none, and the point is to prove the
  // picker, the board link and the build page work, not to fill the site with forks.
  const RUNTIME_FLAG_SEED: Record<string, string[]> = {
    llamacpp: ['-fa 1 -ngl 99', '-fa 1 -ngl 99 -sm layer', 'SYCL backend, -fa 1'],
    ollama: ['flash attention on, KV cache q8_0', 'num_gpu 99, num_batch 512'],
    'openvino-genai': ['PERFORMANCE_HINT=LATENCY', 'PERFORMANCE_HINT=THROUGHPUT', 'dynamic quantization on'],
    'ipex-llm': ['XMX on, sym_int4', 'low-bit sym_int4, bf16 kv'],
    vllm: ['chunked prefill on, --max-num-seqs 8', 'FlashAttention backend'],
    pytorch: ['torch.compile, SDPA flash', 'IPEX optimize, bf16'],
    cascadia: ['int4 weights, batch 1'],
    default: ['batch 1'],
  }

  const CUSTOM_RUNTIME_SEED: [id: string, owner: string, runtime: string, name: string, summary: string][] = [
    ['cr-1', 'arcpilot', 'vllm', 'fused-attn-b60', 'Fused RMSNorm + QKV, tuned for Arc Pro B60 at batch 1'],
    ['cr-2', 'lunarlaker', 'llamacpp', 'sycl-flash-decode', 'Flash-decode kernel for the SYCL backend, Xe2 only'],
    ['cr-3', 'quantqueen', 'vllm', 'paged-kv-int8', 'INT8 KV cache with a paged allocator, Xe matrix path'],
  ]
  const customRuntimes: CustomRuntime[] = CUSTOM_RUNTIME_SEED.map(([id, owner, runtimeId, name, summary], i) => {
    const created = daysAgo(45 - i * 9)
    return {
      id, ownerId: userByHandle[owner].id, owner: userByHandle[owner], runtimeId,
      runtime: RUNTIMES.find((r) => r.id === runtimeId), name,
      repoUrl: `https://github.com/${owner}/${runtimeId}`, summary,
      createdAt: created, updatedAt: created,
    }
  })

  const results: Result[] = []
  const confirmations = new Map<string, Set<string>>()
  const flags = new Map<string, Map<string, FlagReason>>()
  let n = 0
  for (const rig of rigs) {
    const accels = rig.components.filter((c) => ACCEL_TYPES.includes(HARDWARE_BY_ID[c.hardwareId].type))
    const best = accels.reduce((a, b) => ((BASE_TPS[b.hardwareId] ?? 0) > (BASE_TPS[a.hardwareId] ?? 0) ? b : a), accels[0])
    const count = 6 + Math.floor(rand() * 5)
    for (let k = 0; k < count; k++) {
      const componentLevel = rand() < 0.6
      const target = componentLevel ? pick(accels) : best
      const targetHw = HARDWARE_BY_ID[target.hardwareId]
      const usedQty = componentLevel ? (target.quantity > 1 && rand() < 0.4 ? target.quantity : 1) : 1
      const model = pick(['qwen3-8b', 'qwen3-8b', 'qwen3-8b', 'llama-3-1-8b', 'llama-3-1-8b', 'qwen3-30b-a3b', 'qwen3-30b-a3b', 'gemma-3-12b'])
      const quant = pick(MODEL_BY_ID[model].quants.flatMap((q) => (q === 'int4' || q === 'q4_k_m' ? [q, q, q] : [q])))
      const factors = RUNTIME_FACTOR[targetHw.vendor === 'Generic' ? 'Intel' : targetHw.vendor] ?? RUNTIME_FACTOR.Intel
      const runtime = pick(RUNTIMES.filter((r) => factors[r.id] != null))
      const multi = componentLevel ? 1 + (usedQty - 1) * 0.7 : 1 + (best.quantity - 1) * 0.15
      const base = (BASE_TPS[target.hardwareId] ?? 8) * multi
      const decode = base * MODEL_FACTOR[model] * QUANT_FACTOR[quant] * factors[runtime.id] * (0.86 + rand() * 0.26)
      const isCpu = targetHw.type === 'cpu' || targetHw.type === 'npu'
      const promptTps = decode * (isCpu ? 3 + rand() * 3 : 8 + rand() * 17)
      const runDate = daysAgo(Math.floor(rand() * 60))
      const id = `res-${++n}`
      const submitterId = rig.ownerId
      // A slice of runs use one of the seeded customRuntimes for that runtime, when there is one.
      const buildsHere = customRuntimes.filter((b) => b.runtimeId === runtime.id)
      const build = buildsHere.length && rand() < 0.22 ? buildsHere[Math.floor(rand() * buildsHere.length)] : undefined
      const handle = users.find((u) => u.id === submitterId)!.handle
      const result: Result = {
        id, submitterId, modelId: model, quant, runtimeId: runtime.id, runtimeVersion: pick(RUNTIME_VERSIONS[runtime.id]),
        runtimeFlags: rand() < 0.4 ? pick(RUNTIME_FLAG_SEED[runtime.id] ?? RUNTIME_FLAG_SEED.default) : undefined,
        customRuntimeId: build?.id,
        customRuntime: build,
        revision: build ? Math.floor(rand() * 0xfffffff).toString(16).padStart(7, '0') : undefined,
        execution: build ? 'modified' : 'stock',
        rigId: rig.id,
        componentId: componentLevel ? target.hardwareId : undefined,
        componentQuantity: componentLevel ? usedQty : undefined,
        decodeTps: Math.round(decode * 100) / 100,
        promptTps: rand() < 0.8 ? Math.round(promptTps * 10) / 10 : undefined,
        ttftMs: rand() < 0.7 ? Math.round((300 / promptTps) * 1000 + 40 + rand() * 120) : undefined,
        contextLength: rand() < 0.75 ? pick([2048, 4096, 4096, 8192]) : undefined,
        batchSize: rand() < 0.6 ? 1 : undefined,
        notes: rand() < 0.25 ? pick(['Fresh driver, no thermal throttling.', 'Room was warm; expect a few percent more when cool.', 'Speculative decoding off.', 'KV cache 2 GB.', 'Averaged over 5 runs of 256 tokens.']) : undefined,
        repoUrl: rand() < 0.6 ? `https://github.com/${handle}/${rig.id.replace('rig-', '')}-bench` : runtime.repoUrl,
        runDate,
        verification: { status: 'self_reported', confirmations: 0 },
        moderation: { flags: 0, hidden: false },
        createdAt: runDate,
        updatedAt: runDate,
      }
      // community confirmations from other users
      const c = new Set<string>()
      const others = users.filter((u) => u.id !== submitterId)
      const nConf = rand() < 0.5 ? 0 : Math.floor(rand() * 5)
      while (c.size < nConf) c.add(pick(others).id)
      confirmations.set(id, c)
      result.verification = { status: c.size >= 3 ? 'community_verified' : 'self_reported', confirmations: c.size }
      results.push(result)
    }
  }
  // Two implausible entries flagged past the threshold
  for (const id of ['res-7', 'res-41']) {
    const r = results.find((x) => x.id === id)
    if (!r) continue
    const f = new Map<string, FlagReason>()
    for (const u of users.filter((u) => u.id !== r.submitterId).slice(0, 3)) f.set(u.id, 'implausible')
    flags.set(id, f)
    r.moderation = { flags: f.size, hidden: true, reasons: ['implausible'] }
  }

  return { users, rigs, customRuntimes, results, confirmations, flags }
}
