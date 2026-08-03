// Auto-trace one-color raster artwork -> a best-effort vinyl cut vector (potrace). Denise's
// verdict (2026-08-03): potrace beats Vectorizer.AI on the shop's real material, and it's $0
// with no external dependency. Used by the production bundle to add an Auto-Traced/ SVG per
// cuttable upload (the REVISED image for background/color-removed logos). Photos/multi-color art
// are gated out (a silhouette trace of a photo is garbage).
import sharp from 'sharp'
import { trace } from 'potrace'

function potraceTrace(mask: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    trace(mask, { turdSize: 2, optCurve: true, alphaMax: 1, threshold: 128 }, (err: Error | null, svg: string) => (err ? reject(err) : resolve(svg)))
  })
}

// Bi-level black-on-white mask for potrace. Transparent-bg art (white-on-transparent logos after
// Remove White) traces its ALPHA (shape = opaque, ink color irrelevant); opaque art traces luminance.
async function toMask(bytes: Uint8Array): Promise<Buffer> {
  const buf = Buffer.from(bytes)
  const meta = await sharp(buf).metadata()
  if (meta.hasAlpha) {
    const { data } = await sharp(buf).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true })
    let transparent = 0
    const step = Math.max(1, Math.floor(data.length / 8192))
    for (let i = 0; i < data.length; i += step) if (data[i] < 128) transparent++
    if (transparent > 0) return sharp(buf).ensureAlpha().extractChannel(3).negate().threshold(128).png().toBuffer()
  }
  return sharp(buf).flatten({ background: '#ffffff' }).greyscale().threshold(128).png().toBuffer()
}

// Only trace one-color/simple art (a logo has a dominant color + background; a photo doesn't).
async function isCuttable(bytes: Uint8Array): Promise<boolean> {
  const { data, info } = await sharp(Buffer.from(bytes)).resize(80, 80, { fit: 'inside' }).flatten({ background: '#fff' }).raw().toBuffer({ resolveWithObject: true })
  const counts = new Map<string, number>()
  for (let i = 0; i < data.length; i += info.channels) {
    const k = (data[i] >> 5) + '_' + (data[i + 1] >> 5) + '_' + (data[i + 2] >> 5)
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  const total = data.length / info.channels
  const top2 = [...counts.values()].sort((a, b) => b - a).slice(0, 2).reduce((a, b) => a + b, 0) / total
  return top2 > 0.85 && counts.size < 24
}

// Returns an outlined SVG for cuttable one-color art, or null (photo/multi-color/unreadable/vector).
export async function autoTraceSvg(bytes: Uint8Array): Promise<string | null> {
  try {
    if (!(await isCuttable(bytes))) return null
    return await potraceTrace(await toMask(bytes))
  } catch { return null }
}
