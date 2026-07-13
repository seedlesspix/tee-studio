// Shared product-image + product-id helpers used by the designer and the
// template admin, so both resolve colors→images the same way.

export type ColorImageMap = Record<string, { front: string; back: string }>

const normAlnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
const keyFor = (colorName: string) => colorName.toLowerCase().replace(/\s/g, '')

// Match each Shopify color to its front/back images by "the normalized filename
// CONTAINS the normalized color name", longest color first so e.g. "Light Blue"
// wins over "Blue". Tolerant of size prefixes, garment-type suffixes (e.g.
// `_Onesie`), UUID suffixes, and inconsistent naming — unlike the old parser
// that required a fixed `{knownSize}_{Color}_{Front|Back}` shape.
export function buildColorImageMap(
  images: { url: string }[],
  colorNames: string[],
): ColorImageMap {
  const map: ColorImageMap = {}
  const byLongest = [...colorNames].sort((a, b) => normAlnum(b).length - normAlnum(a).length)
  images.forEach(({ url }) => {
    const filename = (url.split('/').pop()?.split('?')[0] || '').toLowerCase()
    const isFront = filename.includes('_front')
    const isBack = filename.includes('_back')
    if (!isFront && !isBack) return
    const normFile = normAlnum(filename)
    const match = byLongest.find(c => normAlnum(c).length > 0 && normFile.includes(normAlnum(c)))
    if (!match) return
    const key = keyFor(match)
    if (!map[key]) map[key] = { front: '', back: '' }
    if (isFront) map[key].front = url
    if (isBack) map[key].back = url
  })
  // Within a color, use whichever side we have if the other is missing.
  Object.keys(map).forEach(key => {
    if (!map[key].front && map[key].back) map[key].front = map[key].back
    if (!map[key].back && map[key].front) map[key].back = map[key].front
  })
  return map
}

export function getColorImages(colorName: string, map: ColorImageMap) {
  return map[keyFor(colorName)] || null
}

// Normalize any Shopify product reference to the canonical GID. Accepts a full
// GID (tolerating the "Products" plural typo), a bare numeric id, or a pasted
// Shopify admin product URL. Returns null if no numeric id can be found.
export function normalizeShopifyProductId(input: string): string | null {
  const s = (input || '').trim()
  if (!s) return null
  if (/^\d+$/.test(s)) return `gid://shopify/Product/${s}`
  const cleaned = s.replace(/[?#].*$/, '')
  const m = cleaned.match(/products?[/:](\d+)/i) || cleaned.match(/(\d+)\s*$/)
  return m ? `gid://shopify/Product/${m[1]}` : null
}
