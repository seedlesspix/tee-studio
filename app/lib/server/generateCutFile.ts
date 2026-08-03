// Shared cut-file generation core (Phase 5). Extracted from the on-demand admin route so
// BOTH /api/admin/cut-file (single side) and /api/admin/production-bundle (whole-order ZIP)
// generate identically. Pure server logic: given a side's frozen canvas JSON + print-area
// snapshot, returns the outlined, physically-sized, color-layered SVG — or a typed failure.
// Loud-fail is preserved: any un-outlinable object yields NO svg (never a partial file).
import * as opentype from 'opentype.js'
import { getFontBuffer, toArrayBuffer, baseFamily } from './fontBuffer'
import { boxFromSnapshot, isSnapshot } from './cutFileGeometry'
import { outlineText, curvedTextToCutPath, assembleCutSvg, type TextPlacement, type CutPath } from './cutFileEngine'
import { clipartToCutPaths } from './clipartCutEngine'

export type CutSvgResult =
  | { ok: true; svg: string }
  | {
      ok: false
      // no-design / no-print-area / no-vector are LEGITIMATE "nothing to cut here" states
      // (e.g. a photo-only side, or a legacy non-templated order) — not errors to alarm on.
      // outline-failed / bad-json are real problems that need a human.
      reason: 'no-design' | 'no-print-area' | 'no-vector' | 'bad-json' | 'outline-failed'
      message: string
      fonts?: string[]
    }

export async function generateCutSvgForSide(
  canvasJson: string | null | undefined,
  snap: unknown,
  opts: { fontOverride?: string | null } = {},
): Promise<CutSvgResult> {
  if (!canvasJson) return { ok: false, reason: 'no-design', message: 'no design on this side' }
  if (!isSnapshot(snap)) return { ok: false, reason: 'no-print-area', message: 'no physical print area (non-templated order?)' }

  let parsed: { objects?: Array<Record<string, unknown>> }
  try { parsed = JSON.parse(canvasJson) } catch { return { ok: false, reason: 'bad-json', message: 'bad canvas json' } }

  // Fabric 7 serializes type PascalCase — "IText"/"Textbox"/"Image" — so match case-insensitively.
  const TEXT_TYPES = ['itext', 'i-text', 'textbox', 'text']
  const isText = (x: Record<string, unknown>) => TEXT_TYPES.includes(String(x.type).toLowerCase()) && !x._isCurvedText
  const isCurved = (x: Record<string, unknown>) => x._isCurvedText === true // baked Image w/ curve stamps
  // SVG clipart: a FabricImage carrying _isSvg (the vector lives at .src, not in canvas_json).
  // Raster-PNG clipart/photos are Images WITHOUT _isSvg — no vector to cut, so excluded here.
  const isClipart = (x: Record<string, unknown>) =>
    String(x.type).toLowerCase() === 'image' && x._isSvg === true && x._isCurvedText !== true
  const objs = (parsed.objects ?? []).filter(x => isText(x) || isCurved(x) || isClipart(x))
  if (objs.length === 0) return { ok: false, reason: 'no-vector', message: 'no vector artwork (text, curved text, or SVG clipart) on this side' }

  const canvasBox = boxFromSnapshot(snap)
  const phys = { width_in: snap.width_in, height_in: snap.height_in }
  const fontCache = new Map<string, opentype.Font>()
  const failures = new Set<string>()
  const paths: CutPath[] = []
  for (const t of objs) {
    // Clipart: no font — fetch + flatten the source SVG, place it, honor recolor. Fail loud
    // (like fonts) if the SVG can't be fetched/parsed or yields no fillable path.
    if (isClipart(t)) {
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
        if (cps.length === 0) failures.add(`clipart ${name} — no fillable vector paths (stroke-only?)`)
        else paths.push(...cps)
      } catch (e) { failures.add(`clipart ${name} — ${(e as Error).message}`) }
      continue
    }
    const curved = isCurved(t)
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
      } catch (e) { failures.add(`${family} — ${(e as Error).message}`); continue }
    }
    if (curved) {
      const d = curvedTextToCutPath(
        font, String(t._originalText ?? ''),
        { curveAmount: Number(t._curveAmount ?? 0), fontSizePx: Number(t._curveFontSize ?? 36), bold: !!t._curveBold, italic: !!t._curveItalic },
        { left: Number(t.left), top: Number(t.top), scaleX: Number(t.scaleX ?? 1), scaleY: Number(t.scaleY ?? 1), angle: Number(t.angle ?? 0) },
        canvasBox, phys,
      )
      paths.push({ d, fill: typeof t._curveFill === 'string' ? t._curveFill : (typeof t.fill === 'string' ? t.fill : '#000000') })
    } else {
      const place: TextPlacement = {
        text: String(t.text ?? ''), fontSizePx: Number(t.fontSize ?? 40),
        scaleX: Number(t.scaleX ?? 1), scaleY: Number(t.scaleY ?? 1),
        left: Number(t.left), top: Number(t.top), angle: Number(t.angle ?? 0),
        fill: typeof t.fill === 'string' ? t.fill : '#000000',
        textAlign: (t.textAlign === 'left' || t.textAlign === 'right') ? t.textAlign : 'center',
        charSpacing: Number(t.charSpacing ?? 0),
        italic,
      }
      paths.push(outlineText(font, place, canvasBox, phys))
    }
  }

  // Never silently drop an object we couldn't outline — surface the list so a partial file
  // can't be mistaken for complete.
  if (failures.size) return { ok: false, reason: 'outline-failed', message: 'Some objects could not be outlined (nothing generated, to avoid a partial file)', fonts: [...failures] }
  if (paths.length === 0) return { ok: false, reason: 'no-vector', message: 'nothing to outline' }

  return { ok: true, svg: assembleCutSvg(paths, phys) }
}
