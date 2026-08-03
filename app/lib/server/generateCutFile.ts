// Shared cut-file generation core (Phase 5). Used by the single-side route, the whole-order
// bundle, AND the layout sheet — one source of outlining truth. Pure server logic: given a
// side's frozen canvas JSON + print-area snapshot, outline each vector object into the same
// 300-DPI physical space. Loud-fail is preserved: any un-outlinable object -> typed failure,
// never a partial cut file.
import * as opentype from 'opentype.js'
import { getFontBuffer, toArrayBuffer, baseFamily } from './fontBuffer'
import { boxFromSnapshot, isSnapshot, type CanvasBox } from './cutFileGeometry'
import { outlineText, curvedTextToCutPath, assembleCutSvg, type TextPlacement, type CutPath, type PhysBox } from './cutFileEngine'
import { clipartToCutPaths } from './clipartCutEngine'

export type CutSvgResult =
  | { ok: true; svg: string }
  | {
      // no-design / no-print-area / no-vector are LEGITIMATE "nothing to cut here" states
      // (a photo-only side, or a legacy non-templated order) — not errors to alarm on.
      // outline-failed / bad-json are real problems that need a human.
      ok: false
      reason: 'no-design' | 'no-print-area' | 'no-vector' | 'bad-json' | 'outline-failed'
      message: string
      fonts?: string[]
    }

// Fabric 7 serializes type PascalCase — "IText"/"Textbox"/"Image" — so match case-insensitively.
const TEXT_TYPES = ['itext', 'i-text', 'textbox', 'text']
export const isTextObj = (x: Record<string, unknown>) => TEXT_TYPES.includes(String(x.type).toLowerCase()) && !x._isCurvedText
export const isCurvedObj = (x: Record<string, unknown>) => x._isCurvedText === true // baked Image w/ curve stamps
// SVG clipart: a FabricImage carrying _isSvg (the vector lives at .src, not in canvas_json).
export const isClipartObj = (x: Record<string, unknown>) =>
  String(x.type).toLowerCase() === 'image' && x._isSvg === true && x._isCurvedText !== true
// Raster image: a FabricImage that is NOT clipart and NOT curved text — a photo or a placed
// converted-file rendition. No vector to CUT, but it IS placed on the LAYOUT.
export const isRasterObj = (x: Record<string, unknown>) =>
  String(x.type).toLowerCase() === 'image' && x._isSvg !== true && x._isCurvedText !== true

type Prepared =
  | { ok: true; objects: Array<Record<string, unknown>>; canvasBox: CanvasBox; phys: PhysBox }
  | { ok: false; reason: 'no-design' | 'no-print-area' | 'bad-json'; message: string }

// Parse + reconstruct the print box, or return why we can't. Shared by cut + layout.
export function prepareSide(canvasJson: string | null | undefined, snap: unknown): Prepared {
  if (!canvasJson) return { ok: false, reason: 'no-design', message: 'no design on this side' }
  if (!isSnapshot(snap)) return { ok: false, reason: 'no-print-area', message: 'no physical print area (non-templated order?)' }
  let parsed: { objects?: Array<Record<string, unknown>> }
  try { parsed = JSON.parse(canvasJson) } catch { return { ok: false, reason: 'bad-json', message: 'bad canvas json' } }
  return {
    ok: true,
    objects: (parsed.objects ?? []) as Array<Record<string, unknown>>,
    canvasBox: boxFromSnapshot(snap),
    phys: { width_in: snap.width_in, height_in: snap.height_in },
  }
}

// Outline ONE vector object (text / curved text / SVG clipart) into color-tagged cut paths,
// or return a failure string. fontCache is shared across a side's objects. This is the single
// source of outlining truth for both the cut file and the layout sheet.
export async function outlineVectorObject(
  t: Record<string, unknown>, canvasBox: CanvasBox, phys: PhysBox,
  fontCache: Map<string, opentype.Font>, opts: { fontOverride?: string | null } = {},
): Promise<{ paths: CutPath[] } | { failure: string }> {
  if (isClipartObj(t)) {
    const name = String(t.src ?? '').split('/').pop() || 'clipart'
    try {
      const cps = await clipartToCutPaths({
        src: String(t.src ?? ''),
        left: Number(t.left), top: Number(t.top),
        scaleX: Number(t.scaleX ?? 1), scaleY: Number(t.scaleY ?? 1),
        angle: Number(t.angle ?? 0),
        width: Number(t.width ?? 0), height: Number(t.height ?? 0),
        currentColor: typeof t._currentColor === 'string' ? t._currentColor : undefined,
      }, canvasBox, phys)
      if (cps.length === 0) return { failure: `clipart ${name} — no fillable vector paths (stroke-only?)` }
      return { paths: cps }
    } catch (e) { return { failure: `clipart ${name} — ${(e as Error).message}` } }
  }

  const curved = isCurvedObj(t)
  const bold = curved ? !!t._curveBold : (t.fontWeight === 'bold' || t.fontWeight === 700)
  const italic = curved ? !!t._curveItalic : (t.fontStyle === 'italic')
  const weight = bold ? 700 : 400 // only multi-weight Google fonts honor it; else ignored
  const family = baseFamily(opts.fontOverride ?? String((curved ? t._curveFontFamily : t.fontFamily) ?? 'Impact'))
  const cacheKey = `${family}-${weight}`
  let font = fontCache.get(cacheKey)
  if (!font) {
    try {
      const f = opentype.parse(toArrayBuffer(await getFontBuffer(family, weight)))
      if (!f.supported) throw new Error('unsupported by opentype')
      font = f; fontCache.set(cacheKey, f)
    } catch (e) { return { failure: `${family} — ${(e as Error).message}` } }
  }

  if (curved) {
    const d = curvedTextToCutPath(
      font, String(t._originalText ?? ''),
      { curveAmount: Number(t._curveAmount ?? 0), fontSizePx: Number(t._curveFontSize ?? 36), bold: !!t._curveBold, italic: !!t._curveItalic },
      { left: Number(t.left), top: Number(t.top), scaleX: Number(t.scaleX ?? 1), scaleY: Number(t.scaleY ?? 1), angle: Number(t.angle ?? 0) },
      canvasBox, phys,
    )
    return { paths: [{ d, fill: typeof t._curveFill === 'string' ? t._curveFill : (typeof t.fill === 'string' ? t.fill : '#000000') }] }
  }

  const place: TextPlacement = {
    text: String(t.text ?? ''), fontSizePx: Number(t.fontSize ?? 40),
    scaleX: Number(t.scaleX ?? 1), scaleY: Number(t.scaleY ?? 1),
    left: Number(t.left), top: Number(t.top), angle: Number(t.angle ?? 0),
    fill: typeof t.fill === 'string' ? t.fill : '#000000',
    textAlign: (t.textAlign === 'left' || t.textAlign === 'right') ? t.textAlign : 'center',
    charSpacing: Number(t.charSpacing ?? 0),
    italic,
  }
  return { paths: [outlineText(font, place, canvasBox, phys)] }
}

export async function generateCutSvgForSide(
  canvasJson: string | null | undefined,
  snap: unknown,
  opts: { fontOverride?: string | null } = {},
): Promise<CutSvgResult> {
  const prep = prepareSide(canvasJson, snap)
  if (!prep.ok) return prep
  const { objects, canvasBox, phys } = prep

  const vectors = objects.filter(x => isTextObj(x) || isCurvedObj(x) || isClipartObj(x))
  if (vectors.length === 0) return { ok: false, reason: 'no-vector', message: 'no vector artwork (text, curved text, or SVG clipart) on this side' }

  const fontCache = new Map<string, opentype.Font>()
  const failures = new Set<string>()
  const paths: CutPath[] = []
  for (const t of vectors) {
    const r = await outlineVectorObject(t, canvasBox, phys, fontCache, opts)
    if ('failure' in r) failures.add(r.failure)
    else paths.push(...r.paths)
  }

  // Never silently drop an object we couldn't outline — surface the list so a partial file
  // can't be mistaken for complete.
  if (failures.size) return { ok: false, reason: 'outline-failed', message: 'Some objects could not be outlined (nothing generated, to avoid a partial file)', fonts: [...failures] }
  if (paths.length === 0) return { ok: false, reason: 'no-vector', message: 'nothing to outline' }

  return { ok: true, svg: assembleCutSvg(paths, phys) }
}
