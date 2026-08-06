import { describe, it, expect } from 'vitest'
import {
  refitObject, refitSide, fitScale, boxFromLTRB, boxToLTRB, rebakeCurveParams,
  type RefitBox, type CanvasObj,
} from '../app/lib/refitEngine'

const B = (left: number, top: number, width: number, height: number): RefitBox => ({ left, top, width, height })
// object factory — defaults to a center-origin image (geometry rides scaleX/scaleY)
const mk = (p: Partial<CanvasObj> = {}): CanvasObj => ({
  type: 'image', originX: 'center', originY: 'center', left: 0, top: 0, width: 100, height: 100, scaleX: 1, scaleY: 1, angle: 0, ...p,
})
const k = (S: RefitBox, T: RefitBox) => fitScale(S, T)

describe('refit engine — core transform math', () => {
  it('1. identity: S===T, object unchanged, k=1', () => {
    const S = B(100, 100, 200, 200)
    const o = mk({ left: 200, top: 200 })
    const r = refitObject(o, S, S, k(S, S))
    expect(k(S, S)).toBe(1)
    expect(r.left).toBeCloseTo(200); expect(r.top).toBeCloseTo(200); expect(r.scaleX).toBeCloseTo(1)
  })

  it('2. pure uniform scale, object at source-center maps to target-center, size x2', () => {
    const S = B(100, 100, 200, 200), T = B(100, 100, 400, 400)
    const r = refitObject(mk({ left: 200, top: 200 }), S, T, k(S, T)) // src center 200 -> tgt center 300
    expect(k(S, T)).toBe(2)
    expect(r.left).toBeCloseTo(300); expect(r.top).toBeCloseTo(300)
    expect(r.scaleX).toBeCloseTo(2); expect(r.scaleY).toBeCloseTo(2)
  })

  it('3. re-center offset: same-size box shifted right', () => {
    const S = B(0, 0, 100, 100), T = B(200, 0, 100, 100)
    const r = refitObject(mk({ left: 50, top: 50 }), S, T, k(S, T))
    expect(r.left).toBeCloseTo(250); expect(r.top).toBeCloseTo(50)
  })

  it('4. corner fractions map exactly (0->0, 1->1)', () => {
    const S = B(0, 0, 100, 100), T = B(0, 0, 200, 200)
    const tl = refitObject(mk({ left: 0, top: 0 }), S, T, k(S, T))
    const br = refitObject(mk({ left: 100, top: 100 }), S, T, k(S, T))
    expect(tl.left).toBeCloseTo(0); expect(tl.top).toBeCloseTo(0)
    expect(br.left).toBeCloseTo(200); expect(br.top).toBeCloseTo(200)
  })

  it('5. cross-aspect uses min-scale', () => {
    const S = B(0, 0, 200, 100), T = B(0, 0, 100, 100)
    expect(k(S, T)).toBe(0.5)
    const r = refitObject(mk({ left: 100, top: 50 }), S, T, k(S, T)) // source center
    expect(r.left).toBeCloseTo(50); expect(r.top).toBeCloseTo(50); expect(r.scaleX).toBeCloseTo(0.5)
  })

  it('6. object outside the box is NOT clamped (overhang preserved)', () => {
    const S = B(0, 0, 100, 100), T = B(0, 0, 200, 200)
    const r = refitObject(mk({ left: -50, top: 50 }), S, T, k(S, T)) // fx = -0.5
    expect(r.left).toBeCloseTo(-100) // 0 + (-0.5)*200
  })

  it('7. non-center origin: center round-trips through left/top', () => {
    const S = B(0, 0, 200, 200), T = B(0, 0, 400, 400)
    const o = mk({ originX: 'left', originY: 'top', left: 100, top: 100, width: 40, height: 20 })
    const r = refitObject(o, S, T, k(S, T)) // k=2, center (120,110) -> (240,220), new extent 80x40
    expect(r.left).toBeCloseTo(200); expect(r.top).toBeCloseTo(200)
    expect(r.width).toBe(40); expect(r.scaleX).toBeCloseTo(2) // width intrinsic, scale carries size
  })

  it('8. rotated non-center origin: left/top stay finite and center is preserved', () => {
    const S = B(0, 0, 200, 200), T = B(0, 0, 400, 400)
    const o = mk({ originX: 'left', originY: 'top', left: 100, top: 100, width: 40, height: 20, angle: 90 })
    const r = refitObject(o, S, T, k(S, T))
    expect(r.left).toBeCloseTo(200); expect(r.top).toBeCloseTo(200)
    expect(Number.isFinite(r.left as number)).toBe(true)
  })

  it('9. refitSide does not mutate inputs (front/back independence)', () => {
    const S = B(0, 0, 100, 100), T = B(0, 0, 200, 200)
    const input = [mk({ left: 50, top: 50 })]
    const snapshot = JSON.stringify(input)
    refitSide(input, S, T)
    expect(JSON.stringify(input)).toBe(snapshot) // untouched
  })
})

describe('refit engine — per-type transforms', () => {
  const S = B(0, 0, 200, 200), T = B(0, 0, 400, 400) // k=2

  it('10. plain text: size via fontSize, scale reset, flagged for rewrap', () => {
    const o = mk({ type: 'i-text', fontSize: 36, scaleX: 1, scaleY: 1, text: 'HI', _originalText: 'HI', charSpacing: 40, fontFamily: 'Impact' })
    const res = refitSide([o], S, T)
    const r = res.objects[0]
    expect(r.fontSize).toBeCloseTo(72); expect(r.scaleX).toBe(1); expect(r.scaleY).toBe(1)
    expect(r.charSpacing).toBe(40); expect(r._originalText).toBe('HI')
    expect(res.textNeedRewrap).toHaveLength(1)
  })

  it('11. plain text folds a manual non-1 scale into fontSize', () => {
    const r = refitObject(mk({ type: 'i-text', fontSize: 20, scaleX: 1.5, scaleY: 1.5 }), S, T, 2)
    expect(r.fontSize).toBeCloseTo(60); expect(r.scaleX).toBe(1) // 20 * 1.5 * 2
  })

  it('12. plain text discards a NON-uniform scale (folds via scaleX)', () => {
    const r = refitObject(mk({ type: 'i-text', fontSize: 10, scaleX: 2, scaleY: 1 }), S, T, 2)
    expect(r.fontSize).toBeCloseTo(40); expect(r.scaleX).toBe(1); expect(r.scaleY).toBe(1) // 10*2*2
  })

  it('13. casing round-trip flag', () => {
    const up = refitObject(mk({ type: 'i-text', text: 'HELLO', _originalText: 'Hello', fontSize: 20 }), S, T, 2)
    const lo = refitObject(mk({ type: 'i-text', text: 'Hello', _originalText: 'Hello', fontSize: 20 }), S, T, 2)
    expect(up.__refitWasUpper).toBe(true)
    expect(lo.__refitWasUpper).toBe(false)
  })

  it('13b. casing detected through wrap-inserted newlines (review catch)', () => {
    // uppercased THEN wrapped: text has '\n' where _originalText has spaces
    const up = refitObject(mk({ type: 'i-text', text: 'HELLO WORLD\nCHAMPIONS', _originalText: 'hello world champions', fontSize: 20 }), S, T, 2)
    const lo = refitObject(mk({ type: 'i-text', text: 'Hello World\nChampions', _originalText: 'Hello World Champions', fontSize: 20 }), S, T, 2)
    expect(up.__refitWasUpper).toBe(true)
    expect(lo.__refitWasUpper).toBe(false)
  })

  it('14. raster image: scale via scaleX/scaleY, width/height untouched', () => {
    const o = mk({ type: 'image', width: 300, height: 200, scaleX: 0.5, scaleY: 0.5, src: 'x', _uploadSrc: 'y' })
    const res = refitSide([o], S, T)
    const r = res.objects[0]
    expect(r.scaleX).toBeCloseTo(1); expect(r.scaleY).toBeCloseTo(1)
    expect(r.width).toBe(300); expect(r.height).toBe(200); expect(r.src).toBe('x'); expect(r._uploadSrc).toBe('y')
    expect(res.textNeedRewrap).toHaveLength(0); expect(res.curvedNeedRebake).toHaveLength(0)
  })

  it('15. image preserves a non-uniform user scale ratio', () => {
    const r = refitObject(mk({ type: 'image', scaleX: 0.5, scaleY: 0.8 }), S, T, 2)
    expect(r.scaleX).toBeCloseTo(1.0); expect(r.scaleY).toBeCloseTo(1.6)
  })

  it('16. clipart == raster geometry; color + src preserved', () => {
    const o = mk({ type: 'image', _isSvg: true, _currentColor: '#dd3333', src: 'svg', scaleX: 0.5, scaleY: 0.5 })
    const r = refitObject(o, S, T, 2)
    expect(r.scaleX).toBeCloseTo(1); expect(r._currentColor).toBe('#dd3333'); expect(r.src).toBe('svg')
  })

  it('17. N&N _nnRole passes through untouched, into skippedNnRole', () => {
    const o = mk({ type: 'i-text', _nnRole: 'name', left: 33, top: 44, fontSize: 64, scaleX: 1.7, fontFamily: 'Impact', fill: '#111' })
    const res = refitSide([o], S, T)
    const r = res.objects[0]
    expect(r.left).toBe(33); expect(r.top).toBe(44); expect(r.fontSize).toBe(64); expect(r.scaleX).toBe(1.7) // geometry untouched
    expect(r.fontFamily).toBe('Impact'); expect(r.fill).toBe('#111'); expect(r._nnRole).toBe('name')
    expect(res.skippedNnRole).toHaveLength(1); expect(res.textNeedRewrap).toHaveLength(0)
  })

  it('18. stroke passthrough (no stroke exists today)', () => {
    const r = refitObject(mk({ type: 'image', stroke: null, strokeWidth: 1 }), S, T, 2)
    expect(r.stroke).toBe(null); expect(r.strokeWidth).toBe(1)
  })
})

describe('refit engine — curved text', () => {
  const S = B(0, 0, 200, 200), T = B(0, 0, 300, 300) // k=1.5

  it('19. transform-only geometry (scale rides scaleX/scaleY, _curve* untouched), surfaced for re-bake', () => {
    const o = mk({ type: 'image', _isCurvedText: true, scaleX: 1, scaleY: 1, _curveFontSize: 40, _curveAmount: 20, src: 'png' })
    const res = refitSide([o], S, T)
    const r = res.objects[0]
    expect(r.scaleX).toBeCloseTo(1.5); expect(r.scaleY).toBeCloseTo(1.5)
    expect(r._curveFontSize).toBe(40); expect(r._curveAmount).toBe(20); expect(r.src).toBe('png') // untouched by the pure engine
    expect(res.curvedNeedRebake).toHaveLength(1); expect(res.textNeedRewrap).toHaveLength(0)
  })

  it('20. rebakeCurveParams scales the font size', () => {
    expect(rebakeCurveParams(40, 20, 2).curveFontSize).toBeCloseTo(80)
  })

  it('21. rebakeCurveParams: 800-branch that would go negative keeps the amount (accepts shift)', () => {
    // cfs=40,A=20 -> floor 60 < 650, A' = (800 - 2*650)/7.5 < 0 -> keep amount
    const r = rebakeCurveParams(40, 20, 2)
    expect(r.curveAmount).toBe(20)
  })

  it('22. rebakeCurveParams: size-floor branch keeps the amount exactly', () => {
    // cfs=600,A=5 -> floor 900 >= 762.5 -> keep amount
    const r = rebakeCurveParams(600, 5, 1.3)
    expect(r.curveAmount).toBe(5); expect(r.curveFontSize).toBeCloseTo(780)
  })

  it('23. rebakeCurveParams preserves sign', () => {
    expect(Math.sign(rebakeCurveParams(40, -20, 2).curveAmount)).toBeLessThanOrEqual(0)
  })
})

describe('refit engine — edge cases', () => {
  it('25. zero source box -> unchanged + degenerate flag', () => {
    const res = refitSide([mk({ left: 10, top: 10 })], B(0, 0, 0, 0), B(0, 0, 100, 100))
    expect(res.degenerate).toBe(true); expect(res.objects[0].left).toBe(10); expect(res.scale).toBe(1)
  })

  it('26. zero target box -> unchanged + degenerate flag', () => {
    const res = refitSide([mk({ left: 10, top: 10 })], B(0, 0, 100, 100), B(0, 0, 0, 0))
    expect(res.degenerate).toBe(true); expect(res.objects[0].left).toBe(10)
  })

  it('27. empty design -> empty objects, scale still computed', () => {
    const res = refitSide([], B(0, 0, 100, 100), B(0, 0, 200, 200))
    expect(res.objects).toHaveLength(0); expect(res.scale).toBe(2)
  })

  it('28. refitSide(objs, B, B) is idempotent (near-identity)', () => {
    const box = B(120, 90, 300, 260)
    const objs = [mk({ left: 200, top: 180, scaleX: 1.3, scaleY: 1.3 }), mk({ type: 'i-text', left: 150, top: 150, fontSize: 40 })]
    const res = refitSide(objs, box, box)
    expect(res.scale).toBeCloseTo(1)
    expect(res.objects[0].left).toBeCloseTo(200); expect(res.objects[0].scaleX).toBeCloseTo(1.3)
    expect(res.objects[1].left).toBeCloseTo(150); expect(res.objects[1].fontSize).toBeCloseTo(40)
  })

  it('29. missing scaleX/scaleY/fontSize default without throwing', () => {
    const o: CanvasObj = { type: 'i-text', originX: 'center', originY: 'center', left: 100, top: 100, width: 50, height: 20 }
    const r = refitObject(o, B(0, 0, 200, 200), B(0, 0, 400, 400), 2)
    expect(r.fontSize).toBeCloseTo(72) // default 36 * 1 * 2
    expect(Number.isFinite(r.left as number)).toBe(true)
  })

  it('30. pathological non-finite input is sanitized — no NaN leaks into the canvas', () => {
    // num() defaults Infinity/NaN to safe values, so the object transforms without producing NaN.
    const o = mk({ type: 'image', originX: 'left', width: Infinity, scaleX: 1 })
    const r = refitSide([o], B(0, 0, 200, 200), B(0, 0, 400, 400)).objects[0]
    expect(Number.isFinite(r.left as number)).toBe(true)
    expect(Number.isFinite(r.top as number)).toBe(true)
    expect(Number.isFinite(r.scaleX as number)).toBe(true)
  })
})

describe('refit engine — box adapters', () => {
  it('boxFromLTRB / boxToLTRB round-trip', () => {
    const ltrb = { left: 10, top: 20, right: 110, bottom: 220 }
    const box = boxFromLTRB(ltrb)
    expect(box).toEqual({ left: 10, top: 20, width: 100, height: 200 })
    expect(boxToLTRB(box)).toEqual(ltrb)
  })
})
