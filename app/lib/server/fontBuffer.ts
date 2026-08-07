// Server-only font loader for the cut-file engine (opentype.js). NODE runtime only.
// Font Management Phase B: every local font FILE now lives in the `fonts` bucket and is resolved via
// designer_fonts.file_url (the browser loads the same files). Dispatch: a registered GOOGLE font
// (fetched + cached, see googleFontBuffer) → else an admin-managed UPLOADED font (bucket file, fetched +
// cached). The old public/fonts LOCAL_FILES map was RETIRED once every font was verified to outline from
// its bucket file (that verification also fixed the Rockwell .ttc / Univers filename quirks — the bucket
// holds the opentype-parseable .ttf and the family name is unchanged).
import { getGoogleFontBuffer, GOOGLE_FONTS } from './googleFontBuffer'
import { serviceClient } from '../customer-library'

const mem = new Map<string, Buffer>()

// Normalize a stored fontFamily ("Impact, sans-serif") down to its base family.
export function baseFamily(family: string): string {
  return family.split(',')[0].trim().replace(/^['"]|['"]$/g, '')
}

// weight (400/700/900) only affects GOOGLE families that ship multiple weights (Montserrat, Amatic SC,
// Yanone Kaffeesatz) — pass the object's fontWeight so bold gets the real cut. Uploaded files are
// single-weight; weight is ignored there.
export async function getFontBuffer(family: string, weight = 400): Promise<Buffer> {
  const key = baseFamily(family)
  if (GOOGLE_FONTS[key]) return getGoogleFontBuffer(key, weight)
  const hit = mem.get(key)
  if (hit) return hit
  // Managed/uploaded font (designer_fonts.file_url) — fetch + cache the bucket file so the cut engine
  // can outline it, exactly like the Google path.
  const url = await uploadedFontUrl(key)
  if (url) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Font file fetch failed for "${key}" (HTTP ${res.status})`)
    const buf = Buffer.from(await res.arrayBuffer())
    mem.set(key, buf)
    return buf
  }
  throw new Error(`No outline source for font family "${key}" (not a known Google font, not a managed uploaded font)`)
}

// Resolve a base family name → the fonts-bucket URL of its uploaded file, via designer_fonts. The
// name→url map is cached after the first lookup (cut-file generation is admin + low-frequency).
let uploadedMap: Map<string, string> | null = null
async function uploadedFontUrl(baseKey: string): Promise<string | null> {
  // Refresh when the map is empty OR doesn't know this family — so a font uploaded after the lambda
  // warmed up still resolves (the mem buffer cache then keeps it from re-querying).
  if (!uploadedMap || !uploadedMap.has(baseKey)) {
    const { data } = await serviceClient()
      .from('designer_fonts')
      .select('value, file_url')
      .not('file_url', 'is', null)
    uploadedMap = new Map()
    for (const r of data ?? []) if (r.file_url) uploadedMap.set(baseFamily(r.value), r.file_url)
  }
  return uploadedMap.get(baseKey) ?? null
}

// opentype.parse() wants an ArrayBuffer; pooled Node Buffers share a backing
// ArrayBuffer at a nonzero byteOffset, so copy this view's bytes into a fresh,
// offset-0 ArrayBuffer (also sidesteps the ArrayBufferLike/SharedArrayBuffer union).
export function toArrayBuffer(buf: Buffer): ArrayBuffer {
  const ab = new ArrayBuffer(buf.byteLength)
  new Uint8Array(ab).set(buf)
  return ab
}
