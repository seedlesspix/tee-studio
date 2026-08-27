// Solid-color SEPARATION for a flattened multicolor raster (Phase 2, cut-model).
// Denise's model (2026-08-27): "pull clean solids, you pick." From ONE flattened upload (e.g. text + stars
// baked over a photograph) produce BOTH:
//   (1) the overall CONTOUR (the whole silhouette) — the printed-transfer cut line, and
//   (2) a VINYL cut outline per flat solid color that forms CLEAN shapes (here: light-blue, black, red) —
//       so the text/stars are cuttable on their own; the photograph's continuous tones are left as the
//       transfer, never emitted as vinyl.
// The bench picks which outlines to actually cut — the tool never hard-splits the pixels.
//
// SOLID vs PHOTO — the keystone signal (calibrated on the shop's first real mixed file, 2026-08-27):
// quantize to a small palette (no dither → flat regions stay flat), then per color measure the AVERAGE
// BOUNDARY COLOR-STEP — how sharply its region transitions to whatever is next to it. A SOLID (glyph, star)
// sits on transparency/contrast → big steps (blue/red/black scored 242-311 of ~300); a PHOTO tone blends
// into neighbours → small steps (every tan/gray ≤158). Perimeter/compactness could NOT separate them (a
// photo quantizes into large contiguous blobs, not speckle); perimeter is kept only as an OOM backstop.
//
// Two tunes from Denise's bench review (2026-08-27):
//   #1 CRISP CONTOUR — the contour is traced at the SAME low blur as the vinyl layers (blur 1), not the
//      heavier silhouette blur, so sharp corners (star points) stay sharp instead of rounding.
//   #2 SUBTRACT THE PHOTO from EVERY vinyl layer — the black COLOR slot also holds the photo's dark
//      shadows. We compute the photo region (the continuous-tone area, internal shadow-holes filled) and
//      cut it out of every vinyl mask, so only art OUTSIDE the photo survives as vinyl.
//
// Traced at the SAME 2400px clamp / viewBox as the contour, so every outline overlays in one coordinate
// space. Node-only (sharp + potrace). Calibrated on ONE file — re-verify thresholds against more mixed art.
import sharp from 'sharp'
import { trace } from 'potrace'
import { traceForCut, type TraceReason } from './autoTrace'

// Same potrace tuning as autoTrace (corner/curve fidelity signed off with Illustrator, Denise 2026-08-04).
function potraceTrace(mask: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    trace(mask, { turdSize: 12, optCurve: true, alphaMax: 0.6, optTolerance: 0.2, threshold: 128 } as Record<string, unknown>,
      (err: Error | null, svg: string) => (err ? reject(err) : resolve(svg)))
  })
}

const WORK = 2400            // long-edge trace resolution — MATCHES the contour so outlines share a viewBox.
const CONTOUR_BLUR = 1       // tune #1: same low blur as the vinyl masks → sharp corners hold on the contour.
const PALETTE = 12           // median-cut target; the photo collapses into a few slots, solids get their own.
const MIN_COVERAGE = 0.02    // a vinyl color must cover ≥2% of the art (drops trivial specks outright).
const MAX_SOLID_COLORS = 6   // Denise: pull up to ~6 solids before it's really a print job. TUNABLE.
// KEYSTONE gate: average boundary color-step (0..~300 summed-RGB; transparent neighbour = 300). Solids sit
// on transparency/contrast → high; photo tones blend → low. blue/red/black ≈ 242-311, every photo tone ≤158.
const SOLID_MIN_STEP = 190
// Pure OOM backstop (NOT the solid test): never hand potrace a mask whose boundary length could OOM it.
const OOM_MAX_PERIMETER = 400_000

export type SolidCut = { color: string; coverage: number; svg: string }
export type SeparateResult = {
  contour: string | null      // the whole-silhouette transfer cut (may be null if not cuttable)
  reason: TraceReason         // cuttable | too_complex | opaque_background | unreadable (from the contour pass)
  islands: number             // contour island count (weeding pieces), for the bench manifest
  solids: SolidCut[]          // per-solid-color vinyl outlines, most-covered first (≤ MAX_SOLID_COLORS)
}

const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
const subpathCount = (svg: string) => (svg.match(/[Mm]/g) || []).length

// Boundary length of a bilevel mask (≈ potrace cost). Cheap raw scan; runs before potrace as the OOM bail.
async function maskPerimeter(maskPng: Buffer): Promise<number> {
  const { data, info } = await sharp(maskPng).raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h, channels: ch } = info
  let t = 0
  for (let y = 0; y < h; y++) {
    const row = y * w * ch
    for (let x = 1; x < w; x++) { const i = row + x * ch; if ((data[i] < 128) !== (data[i - ch] < 128)) t++ }
  }
  for (let x = 0; x < w; x++) {
    const col = x * ch
    for (let y = 1; y < h; y++) { const i = col + y * w * ch; if ((data[i] < 128) !== (data[i - w * ch] < 128)) t++ }
  }
  return t
}

// Fill-holes: given a binary photo mask (1 = continuous-tone pixel), mark every non-photo pixel that is
// ENCLOSED by photo (a dark-shadow hole inside the photograph) as photo too, so subtracting the region
// removes the whole photo — shadows included — from the vinyl layers. Flood the NON-photo from the border;
// anything not reached is an enclosed hole. Iterative (typed-array stack) to handle 2400²-scale masks.
function fillHoles(photo: Uint8Array, w: number, h: number): Uint8Array {
  const N = w * h
  const reached = new Uint8Array(N)
  const stack = new Int32Array(N)
  let top = 0
  const push = (i: number) => { if (!photo[i] && !reached[i]) { reached[i] = 1; stack[top++] = i } }
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1) }
  while (top > 0) {
    const i = stack[--top], x = i % w, y = (i - x) / w
    if (x > 0) push(i - 1)
    if (x < w - 1) push(i + 1)
    if (y > 0) push(i - w)
    if (y < h - 1) push(i + w)
  }
  const region = new Uint8Array(N)
  for (let i = 0; i < N; i++) region[i] = (photo[i] || !reached[i]) ? 1 : 0
  return region
}

export async function separateRasterForCut(bytes: Uint8Array): Promise<SeparateResult> {
  // Cuttability verdict comes from the verified engine (alpha silhouette). Its svg is also the fallback
  // contour if our crisp re-trace ever trips the OOM backstop.
  const c = await traceForCut(bytes)
  const base: SeparateResult = { contour: c.svg, reason: c.reason, islands: c.islands, solids: [] }
  if (c.reason !== 'cuttable') return base

  try {
    const buf = Buffer.from(bytes)

    // Tune #1 — CRISP CONTOUR: trace the alpha silhouette at the vinyl's low blur so corners stay sharp.
    let contour = c.svg, islands = c.islands
    const alphaMask = await sharp(buf).ensureAlpha().extractChannel(3).negate()
      .resize(WORK, WORK, { fit: 'inside' }).blur(CONTOUR_BLUR).threshold(128).png().toBuffer()
    if (await maskPerimeter(alphaMask) <= OOM_MAX_PERIMETER) {
      contour = await potraceTrace(alphaMask)
      islands = subpathCount(contour)
    } // else keep the verified (blur-smoothed) contour rather than risk an OOM.

    // Quantize (palette, no dither, clamped to WORK) → snapped RGBA in the contour's space.
    const quantPng = await sharp(buf).resize(WORK, WORK, { fit: 'inside' }).png({ palette: true, colours: PALETTE, dither: 0 }).toBuffer()
    const { data, info } = await sharp(quantPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const { width: w, height: h, channels: ch } = info
    const keyAt = (i: number) => data[i + 3] < 128 ? -1 : (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
    const rgbStep = (i: number, j: number) => Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2])

    // ONE pass: per-color coverage + average boundary color-step (to differing 4-neighbour; transparent=300).
    const count = new Map<number, number>()
    const stepSum = new Map<number, number>()
    const stepN = new Map<number, number>()
    let opaque = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * ch
        const k = keyAt(i)
        if (k < 0) continue
        opaque++
        count.set(k, (count.get(k) ?? 0) + 1)
        const bump = (j: number) => { const nk = keyAt(j); if (nk !== k) { stepN.set(k, (stepN.get(k) ?? 0) + 1); stepSum.set(k, (stepSum.get(k) ?? 0) + (nk < 0 ? 300 : rgbStep(i, j))) } }
        if (x + 1 < w) bump(i + ch)
        if (x - 1 >= 0) bump(i - ch)
        if (y + 1 < h) bump(i + w * ch)
        if (y - 1 >= 0) bump(i - w * ch)
      }
    }
    if (!opaque) return { ...base, contour, islands }

    const stepOf = (k: number) => (stepN.get(k) ?? 0) ? (stepSum.get(k) ?? 0) / (stepN.get(k) ?? 1) : 0

    // Tune #2 — PHOTO REGION: the continuous-tone area is every opaque pixel whose color has a SOFT boundary
    // (step < SOLID_MIN_STEP). Fill its internal shadow-holes, then subtract it from every vinyl mask.
    const photoKeys = new Set([...count.keys()].filter(k => stepOf(k) < SOLID_MIN_STEP))
    const photoBin = new Uint8Array(w * h)
    for (let p = 0, q = 0; p < data.length; p += ch, q++) {
      const k = data[p + 3] < 128 ? -1 : (data[p] << 16) | (data[p + 1] << 8) | data[p + 2]
      photoBin[q] = (k >= 0 && photoKeys.has(k)) ? 1 : 0
    }
    const photoRegion = photoKeys.size ? fillHoles(photoBin, w, h) : photoBin // no photo → nothing to subtract

    // Candidates: cover ≥ MIN_COVERAGE AND sharp boundaries (avg step ≥ SOLID_MIN_STEP) — most-covered first.
    const candidates = [...count.entries()]
      .map(([k, n]) => ({ k, coverage: n / opaque, step: stepOf(k) }))
      .filter(c2 => c2.coverage >= MIN_COVERAGE && c2.step >= SOLID_MIN_STEP)
      .sort((a, b) => b.coverage - a.coverage)

    const solids: SolidCut[] = []
    for (const cand of candidates) {
      if (solids.length >= MAX_SOLID_COLORS) break
      const r = (cand.k >> 16) & 255, g = (cand.k >> 8) & 255, b = cand.k & 255
      // Mask for THIS color: matching opaque pixels that are NOT in the photo region → black (potrace traces
      // black); everything else white. The photo-region subtraction drops shadow-blacks etc. from the vinyl.
      const gray = Buffer.allocUnsafe(w * h)
      for (let p = 0, q = 0; p < data.length; p += ch, q++) {
        gray[q] = (data[p + 3] >= 128 && data[p] === r && data[p + 1] === g && data[p + 2] === b && !photoRegion[q]) ? 0 : 255
      }
      // Light clean (blur+threshold) to kill anti-alias jitter — same low blur as the contour (crisp corners).
      const maskPng = await sharp(gray, { raw: { width: w, height: h, channels: 1 } }).blur(1).threshold(128).png().toBuffer()
      if (await maskPerimeter(maskPng) > OOM_MAX_PERIMETER) continue // OOM backstop only
      const svg = await potraceTrace(maskPng)
      solids.push({ color: hex(r, g, b), coverage: cand.coverage, svg })
    }
    return { contour, reason: c.reason, islands, solids }
  } catch {
    // Separation is best-effort — the contour (the real transfer cut) already stands on its own.
    return base
  }
}
