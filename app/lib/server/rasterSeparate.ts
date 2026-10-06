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
// NEAR-SHADE MERGE (bench fix 2026-08-28, guarded after the 2026-10-06 review). Quantization splits ONE colour
// into near-identical shades along its soft edge (anti-alias ring, fuzzy upload) or across pixel noise; those
// shades border EACH OTHER, which tanked avgStep and lost a genuine single-colour vinyl (and blue/red next to
// their own dark rings). Fix: merge palette colours that TOUCH and sit within MERGE_DIST of each other,
// transitively (union-find), so a ramp of shades collapses onto its core. GUARD: merging by colour distance
// alone also chained a low-contrast photograph's whole palette into one "solid" and emitted the photo as vinyl
// (review harness, soft_photo_only) — so a set may only grow while its colour span stays ≤ SPAN_MAX. A real
// photo spans far more than that, so it stays several sets with soft mutual boundaries (= photo); a near-flat
// region (a pastel sky) still merges into one colour — as vinyl it IS one colour. Both TUNABLE.
const MERGE_DIST = 40            // summed-RGB between two TOUCHING colours for them to be shades of one colour
const SPAN_MAX = 100             // widest colour span (max pairwise summed-RGB) a merged set may reach
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
    const N = w * h

    // Pass 1 — index every opaque pixel by its RAW palette colour (index into `palette`; NONE = transparent).
    // Every later pass reads these byte arrays: one typed-array lookup per pixel, no Map, no RGBA unpacking.
    const NONE = 255
    const palette: number[] = []              // index → packed 0xRRGGBB
    const indexOf = new Map<number, number>() // packed rgb → index
    const idx = new Uint8Array(N)
    for (let p = 0, q = 0; p < data.length; p += ch, q++) {
      if (data[p + 3] < 128) { idx[q] = NONE; continue }
      const k = (data[p] << 16) | (data[p + 1] << 8) | data[p + 2]
      let i = indexOf.get(k)
      if (i === undefined) { i = palette.length; palette.push(k); indexOf.set(k, i) }
      idx[q] = i
    }
    const P = palette.length
    if (P === 0 || P >= NONE) return { ...base, contour, islands } // nothing opaque → contour only
    const rgbOf = (k: number): [number, number, number] => [(k >> 16) & 255, (k >> 8) & 255, k & 255]
    const cDist = (a: number, b: number) => { const [ar, ag, ab] = rgbOf(a), [br, bg, bb] = rgbOf(b); return Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb) }

    // Pass 2 — per RAW colour: area, and how often it touches each OPAQUE colour (the merge only joins colours
    // that actually border each other).
    const rawCount = new Uint32Array(P), contact = new Uint32Array(P * P)
    const touch = (a: number, b: number) => { if (b !== a && b !== NONE) contact[a * P + b]++ }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const q = y * w + x, a = idx[q]
        if (a === NONE) continue
        rawCount[a]++
        if (x + 1 < w) touch(a, idx[q + 1])
        if (x > 0) touch(a, idx[q - 1])
        if (y + 1 < h) touch(a, idx[q + w])
        if (y > 0) touch(a, idx[q - w])
      }
    }

    // NEAR-SHADE MERGE (see MERGE_DIST / SPAN_MAX): links = touching pairs within MERGE_DIST, closest first; a
    // union is taken only while the merged set's colour span stays ≤ SPAN_MAX. Each set's representative = its
    // highest-coverage member (that colour labels the vinyl layer).
    const pairStep = new Float64Array(P * P)
    for (let a = 0; a < P; a++) for (let b = 0; b < P; b++) pairStep[a * P + b] = cDist(palette[a], palette[b])
    const links: { a: number; b: number; d: number }[] = []
    for (let a = 0; a < P; a++) for (let b = a + 1; b < P; b++) {
      if (!contact[a * P + b] && !contact[b * P + a]) continue
      const d = pairStep[a * P + b]
      if (d <= MERGE_DIST) links.push({ a, b, d })
    }
    links.sort((u, v) => u.d - v.d)
    const parent = Int32Array.from({ length: P }, (_, i) => i)
    const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
    const members: number[][] = Array.from({ length: P }, (_, i) => [i])
    for (const { a, b } of links) {
      const ra = find(a), rb = find(b)
      if (ra === rb) continue
      let span = 0
      for (const u of members[ra]) for (const v of members[rb]) span = Math.max(span, pairStep[u * P + v])
      if (span > SPAN_MAX) continue
      parent[ra] = rb
      members[rb].push(...members[ra]); members[ra] = []
    }
    const repOf = new Uint8Array(P)
    {
      const top = new Int32Array(P).fill(-1)
      for (let a = 0; a < P; a++) { const r = find(a); if (top[r] < 0 || rawCount[a] > rawCount[top[r]]) top[r] = a }
      for (let a = 0; a < P; a++) repOf[a] = top[find(a)]
    }
    const rep = new Uint8Array(N)
    for (let q = 0; q < N; q++) rep[q] = idx[q] === NONE ? NONE : repOf[idx[q]]

    // Pass 3 — per MERGED colour: coverage + average boundary colour-step to the neighbouring MERGED colour
    // (transparent = 300). Rep-to-rep on purpose: a soft ramp between two far-apart regions has a tiny raw pixel
    // step but real region contrast, and region contrast is the "solid on transparency" vs "photo tone" signal
    // the keystone gate was calibrated on.
    const count = new Uint32Array(P), stepSum = new Float64Array(P), stepN = new Uint32Array(P)
    const bump = (k: number, nk: number) => { if (nk === k) return; stepN[k]++; stepSum[k] += nk === NONE ? 300 : pairStep[k * P + nk] }
    let opaque = 0
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const q = y * w + x, k = rep[q]
        if (k === NONE) continue
        opaque++; count[k]++
        if (x + 1 < w) bump(k, rep[q + 1])
        if (x > 0) bump(k, rep[q - 1])
        if (y + 1 < h) bump(k, rep[q + w])
        if (y > 0) bump(k, rep[q - w])
      }
    }
    if (!opaque) return { ...base, contour, islands }
    const stepOf = (k: number) => stepN[k] ? stepSum[k] / stepN[k] : 0

    // Tune #2 — PHOTO REGION: the continuous-tone area is every opaque pixel whose colour has a SOFT boundary
    // (step < SOLID_MIN_STEP). Fill its internal shadow-holes, then subtract it from every vinyl mask.
    const isPhoto = new Uint8Array(P)
    let photoAny = false
    for (let k = 0; k < P; k++) if (count[k] && stepOf(k) < SOLID_MIN_STEP) { isPhoto[k] = 1; photoAny = true }
    const photoBin = new Uint8Array(N)
    for (let q = 0; q < N; q++) photoBin[q] = rep[q] !== NONE && isPhoto[rep[q]] ? 1 : 0
    const photoRegion = photoAny ? fillHoles(photoBin, w, h) : photoBin // no photo → nothing to subtract

    // Candidates: cover ≥ MIN_COVERAGE AND sharp boundaries (avg step ≥ SOLID_MIN_STEP) — most-covered first.
    const candidates: { k: number; coverage: number; step: number }[] = []
    for (let k = 0; k < P; k++) {
      if (!count[k]) continue
      const coverage = count[k] / opaque, step = stepOf(k)
      if (coverage >= MIN_COVERAGE && step >= SOLID_MIN_STEP) candidates.push({ k, coverage, step })
    }
    candidates.sort((a, b) => b.coverage - a.coverage)

    const solids: SolidCut[] = []
    for (const cand of candidates) {
      if (solids.length >= MAX_SOLID_COLORS) break
      // Mask for THIS merged colour: its pixels that are NOT in the photo region → black (potrace traces black);
      // else white. The photo-region subtraction drops shadow-blacks etc. from the vinyl.
      const gray = Buffer.allocUnsafe(N)
      for (let q = 0; q < N; q++) gray[q] = (rep[q] === cand.k && !photoRegion[q]) ? 0 : 255
      // Light clean (blur+threshold) to kill anti-alias jitter — same low blur as the contour (crisp corners).
      const maskPng = await sharp(gray, { raw: { width: w, height: h, channels: 1 } }).blur(1).threshold(128).png().toBuffer()
      if (await maskPerimeter(maskPng) > OOM_MAX_PERIMETER) continue // OOM backstop only
      const svg = await potraceTrace(maskPng)
      const [r, g, b] = rgbOf(palette[cand.k])
      solids.push({ color: hex(r, g, b), coverage: cand.coverage, svg })
    }
    return { contour, reason: c.reason, islands, solids }
  } catch {
    // Separation is best-effort — the contour (the real transfer cut) already stands on its own.
    return base
  }
}
