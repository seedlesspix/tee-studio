// Auto-trace raster artwork -> a best-effort cut vector (potrace). Denise's verdict (2026-08-03):
// potrace beats Vectorizer.AI on the shop's real material, and it's $0 with no external dependency.
// CUTTABILITY MODEL (2026-08-19): a transfer cutter cuts the boundary between printed and unprinted
// EVERYWHERE — outer edge AND interior holes — so ANY color is cuttable by its SILHOUETTE. Transparent
// art traces its alpha contour (color-independent, holes preserved) = the cut; opaque art has no weed
// line (the preview asks the customer to Remove White); fuzzy/feathered art that shatters into too many
// islands is the real "too complex to cut" case. Used by the production bundle (Auto-Traced/) and the
// customer cut preview (via traceForCut).
import sharp from 'sharp'
import { trace } from 'potrace'

// CRISP but NOT JAGGED corners come from THREE things (tuned against Illustrator sign-off, Denise
// 2026-08-04 — first cut rounded letterforms, second over-corrected into jagged noise-facets):
//   (1) trace a HIGH-RES boundary (toMask supersample) — a low-res mask gives stair-stepped edges;
//   (2) CLEAN the mask (Gaussian blur before threshold) — kills sub-feature EDGE JITTER so potrace
//       doesn't trace mask/remove.bg noise as geometry (the jagged failure); large real corners
//       survive the blur, small noise doesn't — the scale heuristic potrace itself can't apply;
//   (3) a MIDDLE alphaMax (0.6, not 0.4) — sharp enough for real corners, not so sharp it facets
//       every residual bump. optTolerance 0.2 keeps curves smooth. NB: potrace can't tell a design
//       corner from a noise corner; blur trades rough-edge fidelity for cut-clean edges — the right
//       call for VINYL (fine roughness can't be weeded anyway).
function potraceTrace(mask: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    trace(mask, { turdSize: 12, optCurve: true, alphaMax: 0.6, optTolerance: 0.2, threshold: 128 }, (err: Error | null, svg: string) => (err ? reject(err) : resolve(svg)))
  })
}

const TRACE_SUPERSAMPLE = 2400 // long-edge target; grow-only (never shrinks already-large art)
const TRACE_BLUR = 5           // px sigma at supersample scale — smooths edge jitter, keeps real corners

// Supersample (grow-only) + optional edge-clean blur, shared by both masks. blur=true is the CLEANED
// mask we output from (crisp, jitter-free); blur=false is the RAW mask used to DETECT complexity by
// island/anchor count — cleaning would smooth a photo into a small blob and hide it.
function prep(s: ReturnType<typeof sharp>, applyBlur: boolean): ReturnType<typeof sharp> {
  const up = s.resize(TRACE_SUPERSAMPLE, TRACE_SUPERSAMPLE, { fit: 'inside', withoutReduction: true, kernel: 'lanczos3' })
  return applyBlur ? up.blur(TRACE_BLUR) : up
}

// Does the art carry MEANINGFUL transparency? That transparency IS the weed line: on a transfer the cutter
// cuts the boundary between printed (opaque) and unprinted (transparent) EVERYWHERE — the outer edge AND
// every interior hole. So the silhouette is "every non-transparent pixel", ANY color — the whole reason
// multicolor art is fully cuttable by contour.
async function hasTransparency(bytes: Uint8Array): Promise<boolean> {
  const buf = Buffer.from(bytes)
  const meta = await sharp(buf).metadata()
  if (!meta.hasAlpha) return false
  const { data } = await sharp(buf).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true })
  const step = Math.max(1, Math.floor(data.length / 8192))
  for (let i = 0; i < data.length; i += step) if (data[i] < 128) return true
  return false
}

// SILHOUETTE mask from the ALPHA channel: opaque (printed) → black shape, transparent → weeded, interior
// transparent holes preserved. COLOR-INDEPENDENT — this is the "flatten all non-transparent pixels to
// black, trace faithfully" model, and it cuts multicolor art by its true contour.
async function toAlphaMask(bytes: Uint8Array, applyBlur: boolean): Promise<Buffer> {
  return prep(sharp(Buffer.from(bytes)).ensureAlpha().extractChannel(3).negate(), applyBlur).threshold(128).png().toBuffer()
}

// Best-effort LUMINANCE mask (dark-on-light) for OPAQUE art. Only valid for one-color-on-light art (the
// isCuttable gate below restricts it): the bench gets it as a starting point. The customer preview does
// NOT present opaque art as a confident cut — an opaque "white box" is ambiguous (removable background vs
// intentional), so we point it out and offer Remove White instead of guessing a cut.
async function toLuminanceMask(bytes: Uint8Array, applyBlur: boolean): Promise<Buffer> {
  return prep(sharp(Buffer.from(bytes)).flatten({ background: '#ffffff' }).greyscale(), applyBlur).threshold(128).png().toBuffer()
}

// A one-color cuttable logo traces to tens–low-hundreds of anchors. A photo that slips the color
// gate (e.g. a low-contrast/noisy shot whose 80px proxy looks flat but whose full-res noise traces
// to a speckle mesh) yields TENS OF THOUSANDS. This backstop rejects that garbage regardless of the
// proxy's blind spot — the raster still ships in Originals/ for manual work.
const MAX_TRACE_COMMANDS = 8000 // supersampling inflates counts; torture-test legit art ~3.3k, photo garbage ~165k
// Clean-trace subpaths (outer boundary + every hole + every speckle) beyond this = weeding hell: too many
// tiny pieces to pick by hand. This is the honest "too complex to cut" gate. TUNABLE against real art —
// a clean busy design measured ~288 islands (fine); a feathered/hairy cutout shatters into 500+.
const MAX_TRACE_ISLANDS = 500

function pathCommandCount(svg: string): number {
  let n = 0
  for (const m of svg.matchAll(/\sd="([^"]*)"/g)) n += (m[1].match(/[MLHVCSQTAZ]/gi) || []).length
  return n
}

// ISLAND count = number of subpaths (each moveto starts one): the outer boundary + every interior hole +
// every speckle. A clean logo silhouette = a handful; a fuzzy/feathered image SHATTERS into hundreds of
// tiny islands = weeding hell. This is the honest meaning of "too complex" and the useful bench signal.
function subpathCount(svg: string): number {
  let n = 0
  for (const m of svg.matchAll(/\sd="([^"]*)"/g)) n += (m[1].match(/[Mm]/g) || []).length
  return n
}

// Is OPAQUE art safe to silhouette by LUMINANCE? Luminance only recovers a true silhouette for
// one-color-on-light art; a multi-color opaque image would trace only its DARK parts (wrong). So this
// gates the opaque best-effort path ONLY. It is NOT a "can this be cut" test anymore — transparent
// multicolor art is fully cuttable by its alpha contour and never comes here. Counts distinct
// coarse-quantized colors on an 80px proxy (one-color ~1–8; a color image spreads to dozens).
async function isCuttable(bytes: Uint8Array): Promise<boolean> {
  const { data, info } = await sharp(Buffer.from(bytes)).resize(80, 80, { fit: 'inside' }).flatten({ background: '#fff' }).raw().toBuffer({ resolveWithObject: true })
  const colors = new Set<string>()
  for (let i = 0; i < data.length; i += info.channels) colors.add((data[i] >> 5) + '_' + (data[i + 1] >> 5) + '_' + (data[i + 2] >> 5))
  return colors.size < 24
}

// WHY a trace succeeded or failed. 'cuttable' → svg present (confident silhouette). The others let the
// customer preview say WHICH issue the art has, or point to the fix:
//   'too_complex'       — the silhouette shatters into too many islands / anchors (fuzzy, feathered, or
//                         bg-removed rough edges, or a photo) — weeding hell; needs cleanup
//   'opaque_background' — the art has NO transparency, so the weed line is ambiguous (a "white box" that's
//                         usually removable but sometimes intentional). We don't guess a cut — we point it
//                         out and offer Remove White. (A best-effort luminance svg may still ride along for
//                         the bench when the art is one-color-on-light.)
//   'unreadable'        — the bytes couldn't be decoded/traced at all
// NOTE: there is no 'multicolor' failure anymore — multicolor art is fully cuttable by contour.
export type TraceReason = 'cuttable' | 'too_complex' | 'opaque_background' | 'unreadable'

// Trace art → { svg (or null), reason, islands }. Single source of truth for BOTH the production bundle
// (which takes .svg) and the customer cut preview (which uses .reason). TRANSPARENT art
// traces its alpha silhouette (color-independent, holes preserved) — this is the cut. OPAQUE art has no
// weed line, so we return 'opaque_background' (best-effort luminance svg for the bench only when it's
// one-color-on-light; the preview treats opaque as "remove the background", never a confident cut).
export async function traceForCut(bytes: Uint8Array): Promise<{ svg: string | null; reason: TraceReason; islands: number }> {
  try {
    const transparent = await hasTransparency(bytes)
    if (transparent) {
      // Alpha silhouette — the real cut for a transfer. Gate on the CLEANED (output) trace, NOT the raw
      // pre-blur trace: the raw is inflated by supersample/anti-alias JITTER the blur removes, so a raw cap
      // false-rejects CRISP fine detail (a sharp many-ray emblem) as "too fuzzy". The honest weeding gate
      // is the clean trace's ISLAND count — fuzzy/feathered edges shatter into many tiny pieces that
      // survive the blur — with a command backstop for pathological density.
      const cleanSvg = await potraceTrace(await toAlphaMask(bytes, true))
      const islands = subpathCount(cleanSvg)
      if (islands > MAX_TRACE_ISLANDS || pathCommandCount(cleanSvg) > MAX_TRACE_COMMANDS) return { svg: null, reason: 'too_complex', islands }
      return { svg: cleanSvg, reason: 'cuttable', islands }
    }
    // Opaque: no transparency to define the weed line. Multicolor-opaque → no trustworthy silhouette (the
    // customer must remove the background); one-color-on-light → a best-effort luminance trace for the
    // bench. Either way the preview shows the "remove background" note, never a confident cut. Photo
    // detection needs the RAW luminance trace (the blur smooths a photo into a small blob that slips the
    // cap), so keep the raw pre-check on THIS path only.
    if (!(await isCuttable(bytes))) return { svg: null, reason: 'opaque_background', islands: 0 }
    const rawSvg = await potraceTrace(await toLuminanceMask(bytes, false))
    if (pathCommandCount(rawSvg) > MAX_TRACE_COMMANDS) return { svg: null, reason: 'too_complex', islands: subpathCount(rawSvg) }
    const cleanSvg = await potraceTrace(await toLuminanceMask(bytes, true))
    const islands = subpathCount(cleanSvg)
    if (islands > MAX_TRACE_ISLANDS || pathCommandCount(cleanSvg) > MAX_TRACE_COMMANDS) return { svg: null, reason: 'too_complex', islands }
    return { svg: cleanSvg, reason: 'opaque_background', islands }
  } catch { return { svg: null, reason: 'unreadable', islands: 0 } }
}
