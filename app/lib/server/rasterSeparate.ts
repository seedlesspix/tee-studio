// Solid-color SEPARATION for a flattened multicolor raster (Phase 2, cut-model).
// Denise's model (2026-08-27): "pull clean solids, you pick." From ONE flattened upload (e.g. text + stars
// baked over a photograph) produce BOTH:
//   (1) the overall CONTOUR (the whole silhouette) — the printed-transfer cut line (via the verified
//       traceForCut alpha silhouette), and
//   (2) a VINYL cut outline per flat solid color that forms CLEAN shapes (here: light-blue, black, red) —
//       so the text/stars are cuttable on their own; the photograph's continuous tones are left as the
//       transfer, never emitted as vinyl.
// The bench picks which outlines to actually cut — the tool never hard-splits the pixels.
//
// HOW solids are told apart from the photo — the KEYSTONE signal (calibrated on the shop's first real mixed
// file, 2026-08-27): quantize to a small palette (no dither → flat regions stay flat), then for each color
// measure the AVERAGE BOUNDARY COLOR-STEP — how sharply its region transitions to whatever is next to it.
// A SOLID (glyph, star) sits on transparency or against contrast → big steps (blue/red/black scored 242-311
// out of ~300). A PHOTO tone blends smoothly into neighbouring tones → small steps (every tan/gray scored
// ≤158). So a step threshold cleanly separates graphic solids from photographic continuous tone, where
// perimeter/compactness could NOT (a photo quantizes into large contiguous skin/gray blobs, not speckle).
// Perimeter is kept ONLY as an OOM backstop before potrace ([[project_cut_preview]]).
//
// Traced at the SAME 2400px clamp / viewBox as the contour, so every outline overlays in one coordinate
// space. Node-only (sharp + potrace). NOTE: calibrated on ONE file — re-verify thresholds against more real
// mixed art before trusting broadly (same "tune against real material" discipline as the OOM guards).
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
const PALETTE = 12           // median-cut target; the photo collapses into a few slots, solids get their own.
const MIN_COVERAGE = 0.02    // a vinyl color must cover ≥2% of the art (drops trivial specks outright).
const MAX_SOLID_COLORS = 6   // Denise: pull up to ~6 solids before it's really a print job. TUNABLE.
// KEYSTONE gate: average boundary color-step (0..~300 in summed-RGB distance; transparent neighbour = 300).
// Solids sit on transparency/contrast → high; photo tones blend → low. blue/red/black ≈ 242-311, every photo
// tone ≤ 158 on the calibration file. 190 sits cleanly between. TUNABLE against more art.
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

const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')

export async function separateRasterForCut(bytes: Uint8Array): Promise<SeparateResult> {
  // (1) The overall contour + cuttability verdict comes from the verified engine (alpha silhouette).
  const c = await traceForCut(bytes)
  const base: SeparateResult = { contour: c.svg, reason: c.reason, islands: c.islands, solids: [] }
  // Only separate solids when the art is a real transparent silhouette. Opaque / too-fuzzy / unreadable →
  // no vinyl separation (the contour pass already told the customer what to do).
  if (c.reason !== 'cuttable') return base

  try {
    const buf = Buffer.from(bytes)
    // Quantize to a small palette, NO dither (flat regions stay flat), clamped to WORK (bounds memory +
    // matches the contour's space). Read back RGBA — colors are now snapped to ≤PALETTE values.
    const quantPng = await sharp(buf).resize(WORK, WORK, { fit: 'inside' }).png({ palette: true, colours: PALETTE, dither: 0 }).toBuffer()
    const { data, info } = await sharp(quantPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const { width: w, height: h, channels: ch } = info

    const keyAt = (i: number) => data[i + 3] < 128 ? -1 : (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
    const rgbStep = (i: number, j: number) => Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2])

    // ONE pass: per-color coverage + average boundary color-step (to differing 4-neighbour; transparent = 300).
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
        // 4-neighbour boundary sampling
        if (x + 1 < w) { const j = i + ch; const nk = keyAt(j); if (nk !== k) { stepN.set(k, (stepN.get(k) ?? 0) + 1); stepSum.set(k, (stepSum.get(k) ?? 0) + (nk < 0 ? 300 : rgbStep(i, j))) } }
        if (x - 1 >= 0) { const j = i - ch; const nk = keyAt(j); if (nk !== k) { stepN.set(k, (stepN.get(k) ?? 0) + 1); stepSum.set(k, (stepSum.get(k) ?? 0) + (nk < 0 ? 300 : rgbStep(i, j))) } }
        if (y + 1 < h) { const j = i + w * ch; const nk = keyAt(j); if (nk !== k) { stepN.set(k, (stepN.get(k) ?? 0) + 1); stepSum.set(k, (stepSum.get(k) ?? 0) + (nk < 0 ? 300 : rgbStep(i, j))) } }
        if (y - 1 >= 0) { const j = i - w * ch; const nk = keyAt(j); if (nk !== k) { stepN.set(k, (stepN.get(k) ?? 0) + 1); stepSum.set(k, (stepSum.get(k) ?? 0) + (nk < 0 ? 300 : rgbStep(i, j))) } }
      }
    }
    if (!opaque) return base

    // Candidates: cover ≥ MIN_COVERAGE AND sharp boundaries (avg step ≥ SOLID_MIN_STEP) — most-covered first.
    const candidates = [...count.entries()]
      .map(([k, n]) => ({ k, coverage: n / opaque, step: (stepN.get(k) ?? 0) ? (stepSum.get(k) ?? 0) / (stepN.get(k) ?? 1) : 0 }))
      .filter(c2 => c2.coverage >= MIN_COVERAGE && c2.step >= SOLID_MIN_STEP)
      .sort((a, b) => b.coverage - a.coverage)

    const solids: SolidCut[] = []
    for (const cand of candidates) {
      if (solids.length >= MAX_SOLID_COLORS) break
      const r = (cand.k >> 16) & 255, g = (cand.k >> 8) & 255, b = cand.k & 255
      // Binary mask for THIS color: matching opaque pixels → black (potrace traces black), else white.
      const gray = Buffer.allocUnsafe(w * h)
      for (let p = 0, q = 0; p < data.length; p += ch, q++) {
        gray[q] = (data[p + 3] >= 128 && data[p] === r && data[p + 1] === g && data[p + 2] === b) ? 0 : 255
      }
      // Light clean (blur+threshold) to kill anti-alias jitter, same spirit as the contour prep.
      const maskPng = await sharp(gray, { raw: { width: w, height: h, channels: 1 } }).blur(1).threshold(128).png().toBuffer()
      // OOM backstop only — a passing solid should be well under this; skip (don't trace) if it isn't.
      if (await maskPerimeter(maskPng) > OOM_MAX_PERIMETER) continue
      const svg = await potraceTrace(maskPng)
      solids.push({ color: hex(r, g, b), coverage: cand.coverage, svg })
    }
    return { ...base, solids }
  } catch {
    // Separation is best-effort — the contour (the real transfer cut) already stands on its own.
    return base
  }
}
