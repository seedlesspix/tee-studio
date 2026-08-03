// Server-only Google-font loader for the cut-file engine. The designer offers 21 Google
// families (via the <link> in app/layout.tsx) with no local file. Google's CSS2 API
// serves woff2 to modern UAs (opentype can't parse woff2), but an OLD-Safari UA yields a
// direct gstatic .ttf — verified. Fetch the CSS, scrape the .ttf URL for the resolved
// weight, download it. Cache in memory + /tmp (survives warm-lambda invocations).
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const TTF_UA =
  'Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; en-us) ' +
  'AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1'

// Family (as stored in fontFamily) -> weights Google Fonts actually ships. Requesting an
// absent weight returns HTTP 400, so we clamp to the nearest available one.
export const GOOGLE_FONTS: Record<string, number[]> = {
  'Amatic SC': [400, 700],
  'Bebas Neue': [400],
  'Bevan': [400],
  'Caesar Dressing': [400],
  'Calistoga': [400],
  'Concert One': [400],
  'Courgette': [400],
  'Creepster': [400],
  'Damion': [400],
  'Fascinate': [400],
  'Handlee': [400],
  'Jersey 10': [400],
  'Lobster': [400],
  'Luckiest Guy': [400],
  'Montserrat': [400, 700, 900],
  'New Rocker': [400],
  'Pacifico': [400],
  'Playball': [400],
  'Rum Raisin': [400],
  'Titan One': [400],
  'Yanone Kaffeesatz': [400, 700],
}

const mem = new Map<string, Buffer>()
const tmpDir = path.join(os.tmpdir(), 'gfont-cache')
const nearest = (avail: number[], w: number) =>
  avail.reduce((b, c) => (Math.abs(c - w) < Math.abs(b - w) ? c : b), avail[0])

export async function getGoogleFontBuffer(family: string, weight = 400): Promise<Buffer> {
  const avail = GOOGLE_FONTS[family]
  if (!avail) throw new Error(`"${family}" is not a registered Google font`)
  const w = nearest(avail, weight)
  const key = `${family}-${w}`

  const hit = mem.get(key)
  if (hit) return hit

  const file = path.join(tmpDir, `${key.replace(/[^a-z0-9-]/gi, '_')}.ttf`)
  try { const disk = await fs.readFile(file); mem.set(key, disk); return disk } catch { /* miss */ }

  const fam = family.replace(/ /g, '+')
  const spec = avail.length > 1 ? `${fam}:wght@${w}` : fam // bare form for single-weight
  const cssUrl = `https://fonts.googleapis.com/css2?family=${spec}&display=swap`

  const cssRes = await fetch(cssUrl, { headers: { 'User-Agent': TTF_UA } })
  if (!cssRes.ok) throw new Error(`Google CSS ${cssRes.status} for ${spec}`)
  const css = await cssRes.text()

  const blocks = css.split('@font-face')
  const block =
    blocks.find(b => new RegExp(`font-weight:\\s*${w}\\b`).test(b)) ??
    blocks.find(b => /\.ttf/.test(b))
  const ttfUrl = block?.match(/https:\/\/[^)]+?\.ttf/)?.[0]
  if (!ttfUrl) throw new Error(`No TTF URL in Google CSS for ${spec}`)

  const ttfRes = await fetch(ttfUrl)
  if (!ttfRes.ok) throw new Error(`Google TTF ${ttfRes.status}`)
  const buf = Buffer.from(await ttfRes.arrayBuffer())

  mem.set(key, buf)
  await fs.mkdir(tmpDir, { recursive: true }).then(() => fs.writeFile(file, buf)).catch(() => {})
  return buf
}
