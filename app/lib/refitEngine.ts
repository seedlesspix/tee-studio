// D2 Design Portability — the pure re-fit engine (JSON -> JSON). No DOM, no Fabric, no node deps:
// operates on serialized canvas objects (the shapes `canvas.toObject(CANVAS_CUSTOM_PROPS)` / a parsed
// canvas_json produce), never live Fabric instances. Importable from the client designer AND server.
//
// The rule (DECIDED): proportional scale-to-fit + re-center, NO stretch. Map every object from a
// SOURCE print box to a TARGET print box, both in the fixed 680x850 canvas space:
//   k = min(T.w/S.w, T.h/S.h)                         // uniform, so nothing distorts
//   newCenter = T.origin + ((oldCenter - S.origin)/S.size) * T.size   // re-project by box fraction
//   size *= k                                          // fontSize (text) or scaleX/scaleY (image/curved)
// Front and back are two independent refitSide() calls, each with its own source/target box.
//
// The engine is copy-in / copy-out and STATELESS — never re-run it on already-re-fitted objects
// (that would scale twice). It is only called at the design open/switch boundary. Per-type:
//   • plain text  -> size rides fontSize (scale folded in, scaleX/scaleY reset to 1); MUST be re-wrapped
//                    from _originalText post-mount by the caller (line breaks depend on the target box).
//   • image/clipart -> size rides scaleX/scaleY (width/height are intrinsic, untouched).
//   • curved text -> transform-only geometry here (cut file stays exact); surfaced in curvedNeedRebake
//                    so the caller can re-bake crisp on mount (rebakeCurveParams computes the new params).
//   • N&N _nnRole -> passed through UNTOUCHED; applyStackLayout regenerates its geometry from the target
//                    print box. Re-projecting AND re-stacking the same object = double-transform.
// Spec: workflow d2-refit-engine-design.

export interface RefitBox { left: number; top: number; width: number; height: number } // 680x850 px
export type LTRB = { left: number; top: number; right: number; bottom: number }

export type CanvasObj = Record<string, unknown> & {
  type?: string
  left?: number; top?: number
  originX?: 'left' | 'center' | 'right'; originY?: 'top' | 'center' | 'bottom'
  width?: number; height?: number
  scaleX?: number; scaleY?: number
  angle?: number
  fontSize?: number; strokeWidth?: number
  text?: string
  _isSvg?: boolean; _isCurvedText?: boolean; _nnRole?: string
  _originalText?: string
  _curveAmount?: number; _curveFontSize?: number
}

export interface RefitResult {
  objects: CanvasObj[]          // re-fitted, new array; inputs never mutated
  scale: number                 // the uniform k applied (1 when degenerate)
  degenerate: boolean           // a source/target box was non-positive -> objects returned unchanged
  textNeedRewrap: CanvasObj[]   // plain i-text -> caller must reWrap from _originalText once the target overlay is mounted
  curvedNeedRebake: CanvasObj[] // _isCurvedText -> caller may re-bake crisp on mount (rebakeCurveParams(*, scale))
  skippedNnRole: CanvasObj[]    // _nnRole passthrough -> caller lets applyStackLayout own their geometry
  flagged: CanvasObj[]          // hit a non-finite computation -> returned untransformed
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const clone = <T>(o: T): T => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)))

// ── box adapters ────────────────────────────────────────────────────────────
// getPrintAreaBounds()/constrainObject/jerseyStackLayout speak {left,top,right,bottom}; boxFromSnapshot
// speaks {left,top,width,height}. Convert at the boundary so the engine only ever sees RefitBox.
export function boxFromLTRB(b: LTRB): RefitBox {
  return { left: b.left, top: b.top, width: b.right - b.left, height: b.bottom - b.top }
}
export function boxToLTRB(b: RefitBox): LTRB {
  return { left: b.left, top: b.top, right: b.left + b.width, bottom: b.top + b.height }
}

const boxOk = (b: RefitBox) => !!b && b.width > 0 && b.height > 0

// The uniform scale-to-fit factor. 1 (a no-op) when either box is degenerate.
export function fitScale(sourceBox: RefitBox, targetBox: RefitBox): number {
  if (!boxOk(sourceBox) || !boxOk(targetBox)) return 1
  return Math.min(targetBox.width / sourceBox.width, targetBox.height / sourceBox.height)
}

type Kind = 'nn' | 'curved' | 'text' | 'image'
function classify(o: CanvasObj): Kind {
  if (o._nnRole) return 'nn'
  if (o._isCurvedText) return 'curved'
  const t = String(o.type ?? '').toLowerCase()
  if (['i-text', 'itext', 'text', 'textbox'].includes(t)) return 'text'
  return 'image' // raster OR _isSvg clipart OR unknown -> geometry rides scaleX/scaleY
}

// Detect that a text object's stored `text` is an uppercased rendering of `_originalText`, so a caller
// re-wrapping from _originalText can re-apply .toUpperCase(). Ambiguous when the original is already
// all-caps (then it reads as not-upper, which is harmless — re-wrap keeps the same glyphs).
// NOTE: `text` carries wrap-inserted '\n' line breaks that `_originalText` (which holds spaces) does
// not, so we normalize whitespace before comparing — otherwise a multi-word uppercased label that
// WRAPPED reads as not-uppercased and the port silently comes back mixed-case.
function wasUppercased(o: CanvasObj): boolean {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
  const orig = String(o._originalText ?? '')
  const cur = norm(String(o.text ?? ''))
  return orig !== '' && cur === norm(orig.toUpperCase()) && cur !== norm(orig)
}

// Transform ONE object. Returns the new object + its kind + whether the transform succeeded (ok:false
// means a non-finite computation, so we returned an untransformed clone). N&N passes through untouched.
function transformOne(obj: CanvasObj, S: RefitBox, T: RefitBox, k: number): { obj: CanvasObj; kind: Kind; ok: boolean } {
  const kind = classify(obj)
  const o = clone(obj)
  if (kind === 'nn') return { obj: o, kind, ok: true } // geometry regenerated by applyStackLayout — do not touch

  if (!boxOk(S) || !boxOk(T) || !Number.isFinite(k) || k <= 0) return { obj: o, kind, ok: false }

  const scaleX = num(o.scaleX, 1), scaleY = num(o.scaleY, 1)
  const w = num(o.width, 0) * scaleX   // rendered (scaled) extents, unrotated
  const h = num(o.height, 0) * scaleY
  const ox = o.originX === 'left' ? 0 : o.originX === 'right' ? 1 : 0.5
  const oy = o.originY === 'top' ? 0 : o.originY === 'bottom' ? 1 : 0.5
  const left = num(o.left, 0), top = num(o.top, 0)
  const th = num(o.angle, 0) * Math.PI / 180
  const cos = Math.cos(th), sin = Math.sin(th)

  // origin point (left,top) -> geometric center (offset rotated by angle; 0 for center-origin, today's only case)
  const dx = (0.5 - ox) * w, dy = (0.5 - oy) * h
  const centerX = left + dx * cos - dy * sin
  const centerY = top + dx * sin + dy * cos

  // re-project the center by its box-relative fraction (unclamped — an overhang stays an overhang)
  const fx = (centerX - S.left) / S.width
  const fy = (centerY - S.top) / S.height
  const newCenterX = T.left + fx * T.width
  const newCenterY = T.top + fy * T.height

  // new rendered extents (uniform k); used for the center->left/top back-conversion
  const newW = w * k, newH = h * k
  const dxN = (0.5 - ox) * newW, dyN = (0.5 - oy) * newH
  const newLeft = newCenterX - (dxN * cos - dyN * sin)
  const newTop = newCenterY - (dxN * sin + dyN * cos)

  // size candidate depends on type
  let newFontSize: number | undefined
  let newScaleX = scaleX, newScaleY = scaleY
  if (kind === 'text') {
    // this codebase keeps text at scaleX=scaleY=1 and carries size in fontSize; fold any manual
    // (handle-drag) scale in via scaleX, drop a non-uniform text scale, reset scale to 1.
    newFontSize = num(o.fontSize, 36) * scaleX * k
    newScaleX = 1; newScaleY = 1
  } else {
    // image / clipart / curved: size rides scaleX/scaleY; width/height (intrinsic) untouched
    newScaleX = scaleX * k
    newScaleY = scaleY * k
  }

  // non-finite guard: never emit NaN into the canvas — fall back to the untransformed clone
  const finite = [centerX, centerY, newCenterX, newCenterY, newLeft, newTop, newScaleX, newScaleY]
    .every(Number.isFinite) && (newFontSize === undefined || Number.isFinite(newFontSize))
  if (!finite) return { obj: clone(obj), kind, ok: false }

  o.left = newLeft
  o.top = newTop
  o.scaleX = newScaleX
  o.scaleY = newScaleY
  if (kind === 'text') {
    o.fontSize = newFontSize
    o.__refitWasUpper = wasUppercased(obj) // transient hint for the caller's post-rewrap re-casing; STRIP before persist
  }
  return { obj: o, kind, ok: true }
}

// Transform a single object with a caller-supplied scale (exported for isolated unit tests).
export function refitObject(obj: CanvasObj, sourceBox: RefitBox, targetBox: RefitBox, scale: number): CanvasObj {
  return transformOne(obj, sourceBox, targetBox, scale).obj
}

// Re-fit one side's objects from sourceBox to targetBox. Front and back call this independently.
export function refitSide(objects: CanvasObj[], sourceBox: RefitBox, targetBox: RefitBox): RefitResult {
  const degenerate = !boxOk(sourceBox) || !boxOk(targetBox)
  const scale = fitScale(sourceBox, targetBox)
  if (degenerate) {
    // no reconstructable box (e.g. a legacy non-templated order) -> treat as already-absolute, untouched
    return { objects: objects.map(clone), scale: 1, degenerate: true, textNeedRewrap: [], curvedNeedRebake: [], skippedNnRole: [], flagged: [] }
  }
  const out: CanvasObj[] = []
  const textNeedRewrap: CanvasObj[] = []
  const curvedNeedRebake: CanvasObj[] = []
  const skippedNnRole: CanvasObj[] = []
  const flagged: CanvasObj[] = []
  for (const src of objects) {
    const { obj, kind, ok } = transformOne(src, sourceBox, targetBox, scale)
    out.push(obj)
    if (!ok) { flagged.push(obj); continue }
    if (kind === 'nn') skippedNnRole.push(obj)
    else if (kind === 'curved') curvedNeedRebake.push(obj)
    else if (kind === 'text') textNeedRewrap.push(obj)
  }
  return { objects: out, scale, degenerate: false, textNeedRewrap, curvedNeedRebake, skippedNnRole, flagged }
}

// Strategy-B re-bake params for a curved text under a uniform scale k (used by the browser caller when
// it chooses to re-curve crisp on mount — the pure engine itself only does transform-only geometry).
// Scales the font size; tries to PRESERVE the curl by re-deriving _curveAmount so the arc radius scales
// by k too. radius = max(cfs*1.5, 800 - |A|*7.5):
//   • cfs*1.5 branch active -> radius already scales with size, keep the amount (exact).
//   • 800 branch active     -> solve |A'| so (800 - |A'|*7.5) = k*(800 - |A|*7.5); if that goes
//                              negative (curl can't be preserved at this scale) keep the amount and
//                              accept the shift (Denise's accepted caveat). Sign is preserved.
export function rebakeCurveParams(curveFontSize: number, curveAmount: number, k: number): { curveFontSize: number; curveAmount: number } {
  const cfs = num(curveFontSize, 36) * k
  const A = Math.abs(num(curveAmount, 0))
  const sign = num(curveAmount, 0) < 0 ? -1 : 1
  const floorRadius = num(curveFontSize, 36) * 1.5
  const ampRadius = 800 - A * 7.5
  if (floorRadius >= ampRadius) return { curveFontSize: cfs, curveAmount } // size-floor branch: keep amount
  const aPrime = (800 - k * ampRadius) / 7.5
  if (!Number.isFinite(aPrime) || aPrime < 0) return { curveFontSize: cfs, curveAmount } // can't preserve — accept shift
  return { curveFontSize: cfs, curveAmount: sign * aPrime }
}
