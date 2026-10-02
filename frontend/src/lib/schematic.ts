import type { HardwareItem } from './api/types.js'

/*
  The parts schematic that stands in for a rig photo, drawn from the catalog. Nothing is drawn per SKU: each spec
  changes the picture.
  - Accelerator: length follows TDP, thickness steps by slot class; the cooler comes from the series (Arc Pro and
    RTX PRO a blower, GeForce and Radeon three axial fans, otherwise two; Gaudi is an OAM module); the model number
    and memory are printed on the shroud.
  - CPU: package class from TDP (mobile, desktop, workstation and server); the die is a grid of its cores; the model
    is printed.
  - Memory: form factor sets the stick, capacity the chip count, RDIMM carries a register chip; on-package memory
    sits beside the CPU as squares.
  Every part is laid out before it is drawn, label first, and the layout reports a clash it could not resolve.
  `checkHardware` runs that over the catalog from scripts/validate-catalog.mjs, so a pull request that adds a part
  with a drawing problem fails there instead of shipping a placeholder nobody looked at.
*/

export type Ink = 'strong' | 'soft' | 'label'
export type Prim =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; rx?: number; ink: Ink; fill?: 'stroke' | 'none'; opacity?: number }
  | { kind: 'circle'; cx: number; cy: number; r: number; ink: Ink }
  | { kind: 'path'; d: string; ink: Ink }
  | { kind: 'text'; x: number; y: number; text: string; size: number; ink: Ink; anchor?: 'start' | 'middle'; weight?: number }

export type Drawing = { w: number; h: number; prims: Prim[]; clashes: string[] }

type Box = { x: number; y: number; w: number; h: number }
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
// Red Hat Mono advances 0.6em per glyph; 0.64 leaves a margin so the estimate never runs short.
const textWidth = (s: string, size: number) => s.length * size * 0.64
const num = (v: string | number | undefined, fallback: number) => (typeof v === 'number' ? v : fallback)

/** The model number as printed on the part: B70, B580, RTX 4090, RTX 5070 Ti, i7-14700K, 285K, w7-3465X, 6960P. */
export function shortName(h: Pick<HardwareItem, 'name'>): string {
  const clean = h.name.replace(/\s*\(.*?\)/g, '').trim()
  const tokens = clean.split(/\s+/)
  const i = tokens.findIndex((t) => /^[A-Za-z]?\d{2,4}[A-Za-z0-9]*$/.test(t) || /^[a-z]\d-\d{4,5}[A-Z]*$/.test(t))
  if (i < 0) return clean
  const prev = tokens[i - 1]
  const next = tokens[i + 1]
  const model = next && /^(Ti|SUPER|Super)$/.test(next) ? `${tokens[i]} ${next}` : tokens[i]
  return prev && /^(RTX|RX|PRO)$/.test(prev) ? `${prev} ${model}` : model
}

// ---------- accelerators ----------

type CoolerStyle = 'blower' | 'axial2' | 'axial3' | 'module'

function gpuClass(h: HardwareItem) {
  const tdp = num(h.specs.tdpW, 150)
  // Length follows TDP continuously, so a B70 is a little longer than a B60; thickness steps by slot class.
  const L = Math.round(Math.max(100, Math.min(230, 96 + tdp * 0.32)))
  const H = tdp <= 80 ? 24 : tdp <= 260 ? 36 : tdp <= 420 ? 44 : 52
  const s = h.series ?? ''
  const style: CoolerStyle = s === 'Gaudi' ? 'module' : /^(Arc Pro|RTX PRO)/.test(s) ? 'blower' : /GeForce|Radeon/.test(s) ? 'axial3' : 'axial2'
  return { L, H, style, tdp }
}

/** One accelerator in its box. The label is placed first; fans give way — smaller, then fewer — then the label shrinks. */
export function drawGpu(h: HardwareItem): Drawing {
  const c = gpuClass(h)
  const name = shortName(h)
  const vram = h.specs.vramGb ? `${h.specs.vramGb}G` : ''
  const prims: Prim[] = []
  const clashes: string[] = []
  if (c.style === 'module') {
    const W = 96, H = 80
    const x = 2, y = 4
    const die: Box = { x: x + W / 2 - 20, y: y + 12, w: 40, h: 34 }
    const label: Box = { x: x + W / 2 - textWidth(name, 11) / 2, y: y + 60, w: textWidth(name, 11), h: 11 }
    if (label.w > W - 8) clashes.push(`${h.name}: the printed model "${name}" is wider than the module`)
    if (overlaps(die, label)) clashes.push(`${h.name}: the printed model sits over the die`)
    prims.push({ kind: 'rect', x, y, w: W, h: H, rx: 4, ink: 'strong' })
    prims.push({ kind: 'rect', ...die, rx: 2, ink: 'strong' })
    for (const [cx, cy] of [[8, 10], [W - 4, 10], [8, H - 2], [W - 4, H - 2]]) prims.push({ kind: 'circle', cx, cy, r: 2, ink: 'strong' })
    prims.push({ kind: 'text', x: x + W / 2, y: label.y + 9, text: name, size: 11, ink: 'strong', anchor: 'middle', weight: 500 })
    if (vram) prims.push({ kind: 'text', x: x + W / 2, y: label.y + 19, text: vram, size: 8, ink: 'soft', anchor: 'middle' })
    return { w: W + 4, h: H + 8, prims, clashes }
  }

  const { L, H } = c
  const want = c.style === 'blower' ? 1 : c.style === 'axial2' ? 2 : 3
  const rMax = H / 2 - 5, rMin = H / 2 - 9
  const sizes = H <= 24 ? [10, 9] : [13, 11, 10]
  let fit: { nameSize: number; nameW: number; labelEnd: number; n: number; r: number } | null = null
  for (const nameSize of sizes) {
    const nameW = textWidth(name, nameSize)
    const labelEnd = 12 + nameW + (vram ? 6 + textWidth(vram, 8) : 0)
    const avail = L - (labelEnd + 8) - 8
    const need = (n: number, r: number) => n * 2 * r + (n - 1) * 6
    let n = want, r = rMax
    while (need(n, r) > avail && r > rMin) r -= 1
    while (need(n, r) > avail && n > 1) n -= 1
    if (need(n, r) <= avail) {
      fit = { nameSize, nameW, labelEnd, n, r }
      break
    }
  }
  if (!fit) {
    const nameSize = sizes[sizes.length - 1]
    clashes.push(`${h.name}: "${name} ${vram}" does not fit a ${L}×${H} card even with one fan; give it a shorter name`)
    fit = { nameSize, nameW: textWidth(name, nameSize), labelEnd: 12 + textWidth(name, nameSize), n: 1, r: rMin }
  }
  const bx = 12, by = 4
  const fans: { cx: number; cy: number; r: number }[] = []
  let cx = L - 8 - fit.r
  for (let i = 0; i < fit.n; i++) {
    fans.unshift({ cx, cy: H / 2, r: fit.r })
    cx -= 2 * fit.r + 6
  }
  const label: Box = { x: 12, y: H / 2 - fit.nameSize / 2, w: fit.labelEnd - 12, h: fit.nameSize }
  for (const f of fans) if (overlaps(label, { x: f.cx - f.r, y: f.cy - f.r, w: 2 * f.r, h: 2 * f.r })) clashes.push(`${h.name}: the printed model sits under a fan`)
  if (label.x + label.w > L - 8) clashes.push(`${h.name}: the printed model runs past the end of the card`)

  prims.push({ kind: 'rect', x: bx - 10, y: by - 4, w: 7, h: H + 8, rx: 1.5, ink: 'strong' })
  prims.push({ kind: 'rect', x: bx, y: by, w: L, h: H, rx: 5, ink: 'strong' })
  for (const f of fans) {
    prims.push({ kind: 'circle', cx: bx + f.cx, cy: by + f.cy, r: f.r, ink: 'strong' })
    prims.push({ kind: 'circle', cx: bx + f.cx, cy: by + f.cy, r: f.r > 10 ? 2.5 : 1.5, ink: 'strong' })
  }
  if (c.tdp > 75) prims.push({ kind: 'rect', x: bx + L - 34, y: by - 3, w: 16, h: 3, ink: 'strong', fill: 'stroke', opacity: 0.6 })
  prims.push({ kind: 'rect', x: bx + 18, y: by + H, w: Math.min(84, L - 40), h: 4, rx: 1, ink: 'strong', fill: 'stroke', opacity: 0.55 })
  const baseline = by + H / 2 + fit.nameSize * 0.36
  prims.push({ kind: 'text', x: bx + 12, y: baseline, text: name, size: fit.nameSize, ink: 'strong', weight: 500 })
  if (vram) prims.push({ kind: 'text', x: bx + 12 + fit.nameW + 6, y: baseline, text: vram, size: 8, ink: 'soft' })
  return { w: L + 12, h: H + 8, prims, clashes }
}

// ---------- CPUs ----------

function cpuClass(h: HardwareItem) {
  const tdp = num(h.specs.tdpW, 65)
  return tdp <= 45 ? { W: 48, H: 48, pins: 0 } : tdp >= 250 ? { W: 80, H: 64, pins: 8 } : { W: 64, H: 64, pins: 6 }
}

/** Package, die grid, printed model. The die shrinks its cells until it clears the label. */
export function drawCpu(h: HardwareItem): Drawing {
  const c = cpuClass(h)
  const name = shortName(h)
  const clashes: string[] = []
  const cores = num(h.specs.cores, 8)
  const cols = Math.ceil(Math.sqrt(cores)), rows = Math.ceil(cores / cols)
  const labelSize = textWidth(name, 8) <= c.W - 10 ? 8 : 7
  if (textWidth(name, labelSize) > c.W - 8) clashes.push(`${h.name}: the printed model "${name}" is wider than the package`)
  const labelTop = c.H - 6 - labelSize
  const gap = 1.5
  let cell = 3
  while (10 + rows * (cell + gap) - gap + 6 + 3 > labelTop && cell > 1.5) cell -= 0.25
  const dw = cols * (cell + gap) - gap, dh = rows * (cell + gap) - gap
  const die: Box = { x: (c.W - dw) / 2, y: 10 + (labelTop - 3 - 10 - dh) / 2, w: dw, h: dh }
  if (die.y + die.h + 3 > labelTop) clashes.push(`${h.name}: the die sits over the printed model`)

  const px = 6, py = 6
  const prims: Prim[] = [{ kind: 'rect', x: px, y: py, w: c.W, h: c.H, rx: c.pins ? 6 : 4, ink: 'soft' }]
  if (c.pins) {
    const stepX = (c.W - 14) / (c.pins - 1), stepY = (c.H - 14) / 5
    let d = ''
    for (let i = 0; i < c.pins; i++) d += `M${px + 7 + i * stepX} ${py - 6}v6M${px + 7 + i * stepX} ${py + c.H}v6`
    for (let i = 0; i < 6; i++) d += `M${px - 6} ${py + 7 + i * stepY}h6M${px + c.W} ${py + 7 + i * stepY}h6`
    prims.push({ kind: 'path', d, ink: 'soft' })
  }
  const dx = px + die.x, dy = py + die.y
  prims.push({ kind: 'rect', x: dx - 3, y: dy - 3, w: dw + 6, h: dh + 6, rx: 1.5, ink: 'soft' })
  for (let i = 0; i < cores; i++) prims.push({ kind: 'rect', x: dx + (i % cols) * (cell + gap), y: dy + Math.floor(i / cols) * (cell + gap), w: cell, h: cell, ink: 'soft', fill: 'stroke' })
  prims.push({ kind: 'text', x: px + c.W / 2, y: py + c.H - 6, text: name, size: labelSize, ink: 'soft', anchor: 'middle' })
  return { w: c.W + 12, h: c.H + 12, prims, clashes }
}

// ---------- memory ----------

function ramClass(h: HardwareItem) {
  const ff = h.specs.formFactor
  if (ff === 'On package') return { onPackage: true as const, H: 14, chips: 0, reg: false }
  const H = ff === 'SO-DIMM' ? 46 : ff === 'RDIMM' ? 80 : 72
  const fits = Math.floor((H - 11) / 7.5)
  const chips = Math.max(2, Math.min(8, fits, Math.round(num(h.specs.capacityGb, 16) / 8)))
  return { onPackage: false as const, H, chips, reg: ff === 'RDIMM' }
}

/** `n` sticks side by side, or `n` on-package squares. Chips per stick are capped by what the stick can hold. */
export function drawRam(h: HardwareItem, n: number): Drawing {
  const c = ramClass(h)
  const prims: Prim[] = []
  if (c.onPackage) {
    for (let i = 0; i < n; i++) prims.push({ kind: 'rect', x: i * 16, y: 0, w: 14, h: 14, rx: 1.5, ink: 'soft' })
    return { w: n * 16 - 2, h: 14, prims, clashes: [] }
  }
  for (let i = 0; i < n; i++) {
    const sx = i * 14
    prims.push({ kind: 'rect', x: sx, y: 0, w: 10, h: c.H, rx: 1.5, ink: 'soft' })
    for (let k = 0; k < c.chips; k++) {
      const cy = 4 + k * 7.5
      if (c.reg && k === Math.floor(c.chips / 2)) prims.push({ kind: 'rect', x: sx + 1, y: cy, w: 8, h: 6, rx: 1, ink: 'soft', fill: 'stroke', opacity: 0.8 })
      else prims.push({ kind: 'rect', x: sx + 2, y: cy, w: 6, h: 6, rx: 1, ink: 'soft' })
    }
    prims.push({ kind: 'rect', x: sx, y: c.H - 7, w: 10, h: 7, ink: 'soft', fill: 'stroke', opacity: 0.5 })
  }
  return { w: n * 14 - 4, h: c.H, prims, clashes: [] }
}

/** One part alone, as the catalog check and the hardware pages see it. */
export function drawHardware(h: HardwareItem): Drawing | null {
  if (h.type === 'gpu') return drawGpu(h)
  if (h.type === 'cpu') return drawCpu(h)
  if (h.type === 'ram') return drawRam(h, 1)
  return null
}

/** Every part laid out; the clashes it could not resolve. Empty means every drawing is clean. */
export function checkHardware(items: HardwareItem[]): string[] {
  return items.flatMap((h) => drawHardware(h)?.clashes ?? [])
}

// ---------- the rig ----------

const shift = (prims: Prim[], dx: number, dy: number): Prim[] =>
  prims.map((p) => {
    switch (p.kind) {
      case 'rect':
      case 'text':
        return { ...p, x: p.x + dx, y: p.y + dy }
      case 'circle':
        return { ...p, cx: p.cx + dx, cy: p.cy + dy }
      case 'path':
        return { ...p, d: p.d.replace(/M(-?[\d.]+) (-?[\d.]+)/g, (_, x, y) => `M${Number(x) + dx} ${Number(y) + dy}`) }
    }
  })

const MAX_CPUS = 4
const MAX_GPUS = 4
const MAX_STICKS = 8
type Column = { w: number; h: number; gap?: number; prims: Prim[] }
type Part = { hardwareId: string; quantity: number }

/**
 * The rig as a picture of its parts: CPU packages, accelerators and memory. Draws up to four CPUs per model,
 * four accelerators and eight sticks, then adds ×N. Integrated parts are carried by their CPU package.
 */
export function drawRig(components: Part[], byId: Record<string, HardwareItem | undefined>): { viewBox: string; prims: Prim[] } {
  const parts = components.map((c) => ({ h: byId[c.hardwareId], q: c.quantity })).filter((p): p is { h: HardwareItem; q: number } => !!p.h)
  const cpus = parts.filter((p) => p.h.type === 'cpu')
  const gpus = parts.filter((p) => p.h.type === 'gpu')
  const ram = parts.find((p) => p.h.type === 'ram')
  const cols: Column[] = []
  for (const cpu of cpus) {
    const d = drawCpu(cpu.h)
    const n = Math.min(cpu.q, MAX_CPUS)
    const columns = Math.min(n, 2), rows = Math.ceil(n / columns)
    const w = columns * d.w + (columns - 1) * 8
    const h = rows * d.h + (rows - 1) * 8
    const prims: Prim[] = []
    for (let i = 0; i < n; i++) prims.push(...shift(d.prims, (i % columns) * (d.w + 8), Math.floor(i / columns) * (d.h + 8)))
    const extra = cpu.q > MAX_CPUS ? 22 : 0
    if (extra) prims.push({ kind: 'text', x: w / 2, y: h + 16, text: `×${cpu.q}`, size: 12, ink: 'label', anchor: 'middle' })
    cols.push({ w, h: h + extra, prims })
  }
  if (ram && ramClass(ram.h).onPackage) {
    const d = drawRam(ram.h, Math.min(ram.q, 4))
    cols.push({ w: d.w, h: d.h, gap: 12, prims: d.prims })
  }
  if (gpus.length) {
    const items: HardwareItem[] = []
    for (const g of gpus) for (let i = 0; i < Math.min(g.q, MAX_GPUS) && items.length < MAX_GPUS; i++) items.push(g.h)
    const total = gpus.reduce((a, g) => a + g.q, 0)
    const drawings = items.map(drawGpu)
    const w = Math.max(...drawings.map((d) => d.w)) + (total > MAX_GPUS ? 34 : 0)
    const h = drawings.reduce((a, d) => a + d.h, 0) + (items.length - 1) * 6
    const prims: Prim[] = []
    let y = 0
    for (const d of drawings) {
      prims.push(...shift(d.prims, 0, y))
      y += d.h + 6
    }
    if (total > MAX_GPUS) prims.push({ kind: 'text', x: w - 26, y: h / 2 + 4, text: `×${total}`, size: 12, ink: 'label' })
    cols.push({ w, h, prims })
  }
  if (ram && !ramClass(ram.h).onPackage) {
    const d = drawRam(ram.h, Math.min(ram.q, MAX_STICKS))
    const extra = ram.q > MAX_STICKS ? 30 : 0
    const prims = [...d.prims]
    if (extra) prims.push({ kind: 'text', x: d.w + 6, y: d.h / 2 + 4, text: `×${ram.q}`, size: 12, ink: 'label' })
    cols.push({ w: d.w + extra, h: d.h, prims })
  }
  if (!cols.length) return { viewBox: '0 0 280 175', prims: [] }
  const W = cols.reduce((a, c, i) => a + c.w + (i ? (c.gap ?? 30) : 0), 0)
  const H = Math.max(...cols.map((c) => c.h))
  // A small rig floats in a tile-shaped frame instead of filling it; a big one grows the frame and scales down.
  const vw = Math.max(W + 40, 280), vh = Math.max(H + 40, 175)
  const prims: Prim[] = []
  let x = (vw - W) / 2
  cols.forEach((c, i) => {
    if (i) x += c.gap ?? 30
    prims.push(...shift(c.prims, x, (vh - c.h) / 2))
    x += c.w
  })
  return { viewBox: `0 0 ${vw} ${vh}`, prims }
}
