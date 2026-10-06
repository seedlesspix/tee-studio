// Solid-colour separation engine (app/lib/server/rasterSeparate.ts) — the cases the 2026-10-06 adversarial
// review of the near-shade merge settled on. Synthetic art is rendered at 1200² and upscaled by the engine to
// its 2400 working size, which is what gives real uploads their anti-alias rings. Guards, in order:
//   1. a single-colour design yields ONE vinyl layer (the 2026-08-28 bench failure: it yielded none);
//   2. crisp brand colours all come out as their own layers (the old gate lost blue/red to their own rings);
//   3. a soft-toned photograph is NEVER emitted as a vinyl layer (the distance-only merge did exactly that).
import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { separateRasterForCut } from '../app/lib/server/rasterSeparate'

const W = 1200, H = 1200
type RGB = [number, number, number]
let seed = 12345
const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 }
const jit = (v: number, j: number) => Math.max(0, Math.min(255, Math.round(v + (rnd() * 2 - 1) * j)))
const blank = () => new Uint8Array(W * H * 4)
const whiteBackdrop = () => { const b = blank(); b.fill(255); for (let q = 3; q < b.length; q += 4) b[q] = 0; return b }
const put = (b: Uint8Array, x: number, y: number, c: RGB, j = 0) => { const i = (y * W + x) * 4; b[i] = jit(c[0], j); b[i + 1] = jit(c[1], j); b[i + 2] = jit(c[2], j); b[i + 3] = 255 }
const circle = (b: Uint8Array, cx: number, cy: number, r: number, c: RGB, j = 0) => { for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (x >= 0 && y >= 0 && x < W && y < H && (x - cx) ** 2 + (y - cy) ** 2 <= r * r) put(b, x, y, c, j) }
const rect = (b: Uint8Array, x0: number, y0: number, x1: number, y1: number, c: RGB, j = 0) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) put(b, x, y, c, j) }
const lerp = (a: RGB, c: RGB, t: number): RGB => [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t]
// a "photo": a smooth two-axis gradient through the stops plus mild grain — continuous tone, no flat colour
const photo = (b: Uint8Array, x0: number, y0: number, x1: number, y1: number, stops: RGB[], grain: number) => {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const t = ((x - x0) / (x1 - x0) + (y - y0) / (y1 - y0)) / 2 * (stops.length - 1)
    const k = Math.min(stops.length - 2, Math.floor(t))
    put(b, x, y, lerp(stops[k], stops[k + 1], t - k), grain)
  }
}
const encode = async (b: Uint8Array, blur = 0) => { let s = sharp(Buffer.from(b), { raw: { width: W, height: H, channels: 4 } }); if (blur) s = s.blur(blur); return new Uint8Array(await s.png().toBuffer()) }

const BLUE: RGB = [30, 90, 168], BLACK: RGB = [0, 0, 0], RED: RGB = [216, 30, 30], INK: RGB = [29, 29, 34]
const SOFT: RGB[] = [[200, 160, 112], [138, 106, 74], [120, 120, 120]] // sepia / skin-tone span, ~150 summed-RGB
const solidsOutside = (b: Uint8Array) => { circle(b, 180, 180, 120, BLUE); rect(b, 900, 80, 1120, 300, BLACK); circle(b, 1000, 1000, 110, RED) }
const SLOW = 30_000

describe('rasterSeparate — near-shade merge', () => {
  it('single ink colour on a noisy (fuzzy) upload → exactly one vinyl layer', async () => {
    seed = 12345
    const b = blank(); circle(b, 600, 520, 380, INK, 14); rect(b, 300, 950, 900, 1100, INK, 14)
    const r = await separateRasterForCut(await encode(b))
    expect(r.reason).toBe('cuttable')
    expect(r.solids).toHaveLength(1)
    expect(r.solids[0].coverage).toBeGreaterThan(0.95)
  }, SLOW)

  it('single colour with a blurred white fringe → still one vinyl layer', async () => {
    const b = whiteBackdrop(); circle(b, 600, 520, 380, INK); rect(b, 300, 950, 900, 1100, INK)
    const r = await separateRasterForCut(await encode(b, 5))
    expect(r.solids).toHaveLength(1)
  }, SLOW)

  it('three crisp brand colours → three layers, each its own colour', async () => {
    const b = blank(); solidsOutside(b)
    const r = await separateRasterForCut(await encode(b))
    expect(r.solids.map(s => s.color).sort()).toEqual(['#000000', '#1e5aa8', '#d81e1e'])
  }, SLOW)

  it('a soft-toned photograph alone → no vinyl layer (it is the transfer)', async () => {
    seed = 12345
    const b = blank(); photo(b, 200, 200, 1000, 1000, SOFT, 4)
    const r = await separateRasterForCut(await encode(b))
    expect(r.reason).toBe('cuttable')
    expect(r.solids).toHaveLength(0)
  }, SLOW)

  it('solids over a soft photo → the photo is never a layer; the red outside it survives', async () => {
    seed = 12345
    const b = blank(); solidsOutside(b); photo(b, 300, 350, 850, 900, SOFT, 4)
    const r = await separateRasterForCut(await encode(b))
    expect(r.solids.every(s => s.coverage < 0.5)).toBe(true) // the photo is ~70% of the art
    expect(r.solids.some(s => s.color === '#d81e1e')).toBe(true)
  }, SLOW)
})
