// Auto-trace one-color raster artwork -> a best-effort vinyl cut vector (potrace). Denise's
// verdict (2026-08-03): potrace beats Vectorizer.AI on the shop's real material, and it's $0
// with no external dependency. Used by the production bundle to add an Auto-Traced/ SVG per
// cuttable upload (the REVISED image for background/color-removed logos). Photos/multi-color art
// are gated out (a silhouette trace of a photo is garbage).
import sharp from 'sharp'
import { trace } from 'potrace'

// CRISP CORNERS come from two things (tuned against Illustrator sign-off, Denise 2026-08-04, after
// the first cut rounded letterforms): (1) trace a HIGH-RES boundary — see toMask's supersample; a
// low-res mask gives potrace stair-stepped edges it then rounds; (2) a LOW alphaMax keeps corners
// sharp while gentle angles still smooth into curves (default 1.0 rounded logo corners). optTolerance
// 0.1 (vs 0.2) keeps the fitted curve faithful. turdSize scaled up for the larger canvas.
function potraceTrace(mask: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    trace(mask, { turdSize: 8, optCurve: true, alphaMax: 0.4, optTolerance: 0.1, threshold: 128 }, (err: Error | null, svg: string) => (err ? reject(err) : resolve(svg)))
  })
}

const TRACE_SUPERSAMPLE = 2400 // long-edge target; grow-only (never shrinks already-large art)

// Bi-level black-on-white mask for potrace. Transparent-bg art (white-on-transparent logos after
// Remove White) traces its ALPHA (shape = opaque, ink color irrelevant); opaque art traces luminance.
// The mask is supersampled while still CONTINUOUS-tone, THEN thresholded, so the black/white boundary
// is sampled finely and corners stay crisp (thresholding first, at source res, is what softened them).
async function toMask(bytes: Uint8Array): Promise<Buffer> {
  const buf = Buffer.from(bytes)
  const meta = await sharp(buf).metadata()
  const up = (s: sharp.Sharp) => s.resize(TRACE_SUPERSAMPLE, TRACE_SUPERSAMPLE, { fit: 'inside', withoutReduction: true, kernel: 'lanczos3' })
  if (meta.hasAlpha) {
    const { data } = await sharp(buf).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true })
    let transparent = 0
    const step = Math.max(1, Math.floor(data.length / 8192))
    for (let i = 0; i < data.length; i += step) if (data[i] < 128) transparent++
    if (transparent > 0) return up(sharp(buf).ensureAlpha().extractChannel(3).negate()).threshold(128).png().toBuffer()
  }
  return up(sharp(buf).flatten({ background: '#ffffff' }).greyscale()).threshold(128).png().toBuffer()
}

// A one-color cuttable logo traces to tens–low-hundreds of anchors. A photo that slips the color
// gate (e.g. a low-contrast/noisy shot whose 80px proxy looks flat but whose full-res noise traces
// to a speckle mesh) yields TENS OF THOUSANDS. This backstop rejects that garbage regardless of the
// proxy's blind spot — the raster still ships in Originals/ for manual work.
const MAX_TRACE_COMMANDS = 8000 // supersampling inflates counts; torture-test legit art ~3.3k, photo garbage ~165k

function pathCommandCount(svg: string): number {
  let n = 0
  for (const m of svg.matchAll(/\sd="([^"]*)"/g)) n += (m[1].match(/[MLHVCSQTAZ]/gi) || []).length
  return n
}

// Reject genuinely MULTI-COLOR art (a full-color photo, or a many-ink logo that needs per-color
// separation, not one silhouette): count distinct coarse-quantized colors on an 80px proxy. A
// one-color logo — bold OR thin/wordmark — quantizes to a handful (~1–8, anti-alias fringe aside);
// a color photo or multi-ink mascot spreads to dozens.
// NB: an earlier "top-2 dominance > 0.85" test was REMOVED — measured data showed it rejected thin
// one-color logos (wordmarks land ~0.79) while PASSING smooth-noise photos (~0.96). The post-trace
// anchor cap (below) is the reliable garbage filter; color-count is the reliable multi-color filter.
async function isCuttable(bytes: Uint8Array): Promise<boolean> {
  const { data, info } = await sharp(Buffer.from(bytes)).resize(80, 80, { fit: 'inside' }).flatten({ background: '#fff' }).raw().toBuffer({ resolveWithObject: true })
  const colors = new Set<string>()
  for (let i = 0; i < data.length; i += info.channels) colors.add((data[i] >> 5) + '_' + (data[i + 1] >> 5) + '_' + (data[i + 2] >> 5))
  return colors.size < 24
}

// Returns an outlined SVG for cuttable one-color art, or null (photo/multi-color/unreadable/vector).
export async function autoTraceSvg(bytes: Uint8Array): Promise<string | null> {
  try {
    if (!(await isCuttable(bytes))) return null
    const svg = await potraceTrace(await toMask(bytes))
    if (pathCommandCount(svg) > MAX_TRACE_COMMANDS) return null // backstop: a slipped photo = garbage mesh
    return svg
  } catch { return null }
}
