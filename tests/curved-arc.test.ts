import { describe, it, expect } from 'vitest'
import { createCanvas } from 'canvas'
import { renderCurvedArc, type CanvasFactory, type CurveParams } from '../app/lib/curvedArc'

// Drive the SAME pure renderer the browser uses, but against node-canvas, so the extraction is proven
// to render deterministically + structurally. (Byte-identity to the pre-extraction browser code is
// guaranteed by the verbatim move; a browser pixel-golden isn't feasible headless — fonts differ — so
// this locks determinism + shape and guards against a future regression.)
const nodeFactory: CanvasFactory = (w, h) =>
  createCanvas(Math.max(1, Math.floor(w)), Math.max(1, Math.floor(h))) as unknown as ReturnType<CanvasFactory>

const P = (over: Partial<CurveParams> = {}): CurveParams =>
  ({ curveAmount: 20, fontSize: 48, fontFamily: 'Arial', fill: '#000000', bold: false, italic: false, ...over })

describe('curved arc renderer (extraction parity)', () => {
  it('produces a cropped PNG data URL with positive dimensions', () => {
    const r = renderCurvedArc('CHAMPIONS', P(), nodeFactory)
    expect(r.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
    expect(r.width).toBeGreaterThan(0); expect(r.height).toBeGreaterThan(0)
  })

  it('is deterministic: same input -> byte-identical output', () => {
    const a = renderCurvedArc('SMITH', P(), nodeFactory)
    const b = renderCurvedArc('SMITH', P(), nodeFactory)
    expect(a.dataUrl).toBe(b.dataUrl)
    expect(a.width).toBe(b.width); expect(a.height).toBe(b.height)
  })

  it('curve-up and curve-down render differently', () => {
    const up = renderCurvedArc('ARC', P({ curveAmount: 30 }), nodeFactory)
    const down = renderCurvedArc('ARC', P({ curveAmount: -30 }), nodeFactory)
    expect(up.dataUrl).not.toBe(down.dataUrl)
  })

  it('a longer string crops wider', () => {
    const short = renderCurvedArc('A', P({ curveAmount: 5 }), nodeFactory)
    const long = renderCurvedArc('AAAAAAAAAA', P({ curveAmount: 5 }), nodeFactory)
    expect(long.width).toBeGreaterThan(short.width)
  })

  it('a larger font crops taller', () => {
    const small = renderCurvedArc('X', P({ fontSize: 24 }), nodeFactory)
    const big = renderCurvedArc('X', P({ fontSize: 96 }), nodeFactory)
    expect(big.height).toBeGreaterThan(small.height)
  })
})
