// Server-only font loader for the cut-file engine (opentype.js). NODE runtime only —
// reads the local font files bundled into the lambda via next.config's
// outputFileTracingIncludes. Stage 1b uses the LOCAL branch (Impact); Google-font
// fetching is a later phase.
import { promises as fs } from 'node:fs'
import path from 'node:path'

// CSS family name (as used in globals.css @font-face / the designer's fontFamily) ->
// file in public/fonts. Rockwell.ttc is DELIBERATELY absent — opentype.js throws on
// TrueType Collections ("ttcf"); that needs a pre-split, a later phase.
// 'Univers' maps to a known-malformed file (globals.css:266) — it will fail to parse
// and the route returns a clear error rather than a bad cut.
const LOCAL_FILES: Record<string, string> = {
  'American Typewriter': 'American Typewriter Copywriter.ttf',
  'Arial Bold': 'Arial Bold.ttf',
  'Ballpark Weiner': 'Ballpark-Stadium .TTF',
  'Big Bimbo': 'Big-Bimbo-Rockit Ship.ttf',
  'Blackout': 'Black-out-Favorite child.ttf',
  'Britannic Bold': 'Britannic Bold Bold.ttf',
  'Brush Script': 'Brush Script.ttf',
  'Brush Script Opti': 'BrushScriptOpti-Regular.otf',
  'College Block': 'College Block.otf',
  'Cooper': 'Cooper-Different Strokes.ttf',
  'Cubano': 'Cubano-Mexicano.ttf',
  'Eras': 'Eras.ttf',
  'Exotic': 'Exotic.ttf',
  'Futura': 'Futura Bold.otf',
  'Handel Gothic': 'HandelGothic.ttf',
  'Honey Script': 'Honey-Script-Poobear.ttf',
  'Impact': 'Impact.ttf',
  'ITC Franklin Gothic': 'ITCFranklinGothicStd-MdCd.otf',
  'Iron On Black': 'Iron-OnBlackletter-Regular-WALF.ttf',
  'Kaufman': 'Kaufmann-Bold.otf',
  'KG One More Night': 'KGOneMoreNight-Brunch.ttf',
  'Lemon Milk': 'LemonMilk.otf',
  'Northern Lights': 'NorthernLights-Moonshadow.ttf',
  'Octin Sport': 'Octin-sports-Day School.ttf',
  'Diana': 'OPTIDiannaScript-BoldAgen.otf',
  'Princetown': 'Princetown.ttf',
  'Scratch': 'Scratch_.ttf',
  'Sign Painter': 'SignPainter HouseScript Regular.ttf',
  'Souvenir': 'Souvenir-Bold.ttf',
  'Superstar': 'Superstar-Highschool High.ttf',
  'Swiss': 'Swiss721Bold.ttf',
  'Turnpike': 'Turnpike.ttf',
  'Univers': 'Univers-Condensed-Sans alot.ttf',
  'Wagner Modern': 'Wagner Modern.ttf',
}

const fontsDir = () => path.join(process.cwd(), 'public', 'fonts')
const mem = new Map<string, Buffer>()

// Normalize a stored fontFamily ("Impact, sans-serif") down to its base family.
export function baseFamily(family: string): string {
  return family.split(',')[0].trim().replace(/^['"]|['"]$/g, '')
}

export async function getFontBuffer(family: string): Promise<Buffer> {
  const key = baseFamily(family)
  const hit = mem.get(key)
  if (hit) return hit
  const file = LOCAL_FILES[key]
  if (!file) throw new Error(`No local outline source for font family "${key}"`)
  const buf = await fs.readFile(path.join(fontsDir(), file))
  mem.set(key, buf)
  return buf
}

// opentype.parse() wants an ArrayBuffer; pooled Node Buffers share a backing
// ArrayBuffer at a nonzero byteOffset, so copy this view's bytes into a fresh,
// offset-0 ArrayBuffer (also sidesteps the ArrayBufferLike/SharedArrayBuffer union).
export function toArrayBuffer(buf: Buffer): ArrayBuffer {
  const ab = new ArrayBuffer(buf.byteLength)
  new Uint8Array(ab).set(buf)
  return ab
}
