// CanvasStage extraction — parity harness (READ-ONLY instrumentation, dev-only).
//
// Golden-master characterization of the load-bearing print-area geometry, so we
// can prove the extracted CanvasStage behaves IDENTICALLY to today. Baseline on
// `main` → golden; run again after extraction → diff to zero. Any change in a
// coordinate, a bound, a hash, or a surviving custom prop is a silent-shift
// signal to chase before anything else splits.
//
// This module does NOT touch the designer's real state or persist anything — it
// creates throwaway Fabric objects, calls the exposed geometry/export functions
// with fixed inputs, records their outputs, and clears the canvas back. It runs
// ONLY when the designer is opened with ?parity=1 (see DesignerCanvas), driven
// from the browser console: `await window.__parity.run()`.
//
// Coverage note (v1): the deterministic, function-level paths are captured here
// (letterbox transform, DOM-measured bounds, constrain, reWrap, custom-prop
// survival, export hashes). The event-wired interactions (scale-clamp on drag,
// side-slot routing through frontObjectsRef/backObjectsRef) move VERBATIM in the
// extraction and are covered by the human side-by-side backstop; if the first
// baseline run shows we want them characterized too, we expose those refs and
// add fixtures — the harness is designed to grow.

import { toPctContain, letterboxInfo } from './printAreaGeometry'

export type ParityApi = {
  canvas: any
  CANVAS_CUSTOM_PROPS: string[]
  constrainObject: (
    obj: any,
    bounds: { left: number; top: number; right: number; bottom: number }
  ) => void
  getPrintAreaBounds: () => { left: number; top: number; right: number; bottom: number } | null
  reWrapText: (
    text: string,
    targetFontSize: number,
    fontFamily: string,
    bold: boolean,
    italic: boolean
  ) => { text: string; fontSize: number }
  exportCanvasSVG: (canvas: any) => string
  exportCanvasPNG: (canvas: any, shirtSrc: string | null | undefined) => Promise<Blob | null>
  shirtImg: HTMLImageElement | null
  container: { W: number; H: number }
  currentSide: () => 'front' | 'back'
  productLabel: string
}

// Stable, order-independent string hash (FNV-1a, 32-bit hex). Used so a golden
// file stays small — we diff hashes, and only dig into full strings on a miss.
function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

async function blobHash(b: Blob | null): Promise<string> {
  if (!b) return 'null'
  const buf = new Uint8Array(await b.arrayBuffer())
  let h = 0x811c9dc5
  for (let i = 0; i < buf.length; i++) {
    h ^= buf[i]
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0') + ':' + buf.length
}

// round to 3 decimals so sub-pixel float noise doesn't create false diffs while
// still catching any real geometry shift.
const r3 = (n: number) => Math.round(n * 1000) / 1000
const r3pct = (p: { xPct: number; yPct: number; widthPct: number; heightPct: number }) => ({
  xPct: r3(p.xPct), yPct: r3(p.yPct), widthPct: r3(p.widthPct), heightPct: r3(p.heightPct),
})

export async function runParityFixtures(api: ParityApi) {
  const fabric = await import('fabric')
  const IText = (fabric as any).IText
  const canvas: any = api.canvas
  const CP = api.CANVAS_CUSTOM_PROPS

  // Snapshot the live canvas so the harness leaves the designer untouched.
  const liveJson = canvas.toObject(CP)
  const out: Record<string, unknown> = {
    product: api.productLabel,
    side: api.currentSide(),
    canvas: { width: canvas.width, height: canvas.height },
    container: api.container,
  }

  try {
    // ---- This product's REAL mockup: the letterbox offset (all current
    //      garments are 2000×2000 square → offset 0.1) ----
    const img = api.shirtImg
    if (img && img.naturalWidth) {
      const lb = letterboxInfo(img.naturalWidth, img.naturalHeight, api.container.W, api.container.H)
      out.mockupLetterbox = {
        naturalW: img.naturalWidth, naturalH: img.naturalHeight,
        imageAspect: r3(lb.imageAspect), containerAspect: r3(lb.containerAspect),
        mode: lb.mode, renderFrac: r3(lb.renderFrac), offset: r3(lb.offset),
      }
    } else {
      out.mockupLetterbox = { note: 'shirt image not loaded — reopen after the mockup renders' }
    }

    // ---- FIXTURE 11: non-square MOCKUP ratios through the REAL containment
    //      transform (toPctContain, shared with the designer). Today's catalog
    //      is all square (offset 0.1); this pins the letterbox geometry at
    //      NON-0.1 offsets so a future wider/taller garment mockup is protected.
    //      A fixed proportional print area is fed at each synthetic mockup size;
    //      the % output reflects the letterbox offset for that ratio. Pure math,
    //      product-independent — identical on every run and every product.
    const synthMockups: Array<[string, number, number]> = [
      ['square-2000x2000', 2000, 2000],   // matches today's real garments (offset 0.1)
      ['wide-3000x1000', 3000, 1000],     // landscape mockup → big top/bottom letterbox
      ['tall-1000x3000', 1000, 3000],     // portrait mockup  → big left/right pillarbox
      ['portrait-1600x2000', 1600, 2000], // aspect == container (0.8) → offset 0, boundary
    ]
    out.fixture11 = synthMockups.map(([name, nw, nh]) => {
      // a print area at 15%/10% inset, 70%×55% of the mockup (natural px)
      const area = { x_px: nw * 0.15, y_px: nh * 0.10, width_px: nw * 0.70, height_px: nh * 0.55 }
      const lb = letterboxInfo(nw, nh, api.container.W, api.container.H)
      return {
        mockup: name, naturalW: nw, naturalH: nh,
        mode: lb.mode, offset: r3(lb.offset),
        pct: r3pct(toPctContain(area, nw, nh, api.container.W, api.container.H)),
      }
    })

    // ---- The DOM-rect invariant: the print-area bounds (canvas px) ----
    const bounds = api.getPrintAreaBounds()
    out.printAreaBounds = bounds
      ? { left: r3(bounds.left), top: r3(bounds.top), right: r3(bounds.right), bottom: r3(bounds.bottom),
          width: r3(bounds.right - bounds.left), height: r3(bounds.bottom - bounds.top) }
      : null

    if (bounds) {
      // ---- Fixtures 2: constrain an object placed past each edge ----
      const mk = () => new IText('PARITY', { left: 0, top: 0, fontFamily: 'Arial', fontSize: 40, originX: 'left', originY: 'top' })
      const edges: Record<string, { left: number; top: number }> = {}
      const cx = (bounds.left + bounds.right) / 2
      const cy = (bounds.top + bounds.bottom) / 2
      const cases: Array<[string, number, number]> = [
        ['past-left', bounds.left - 200, cy],
        ['past-right', bounds.right + 200, cy],
        ['past-top', cx, bounds.top - 200],
        ['past-bottom', cx, bounds.bottom + 200],
      ]
      for (const [name, left, top] of cases) {
        const o = mk()
        o.set({ left, top })
        canvas.add(o)
        api.constrainObject(o, bounds)
        edges[name] = { left: r3(o.left), top: r3(o.top) }
        canvas.remove(o)
      }
      out.constrain = edges
    }

    // ---- Fixture 4: reWrapText on representative strings ----
    const samples = ['HI', 'THE PLUMB FAMILY REUNION', 'Ham\nCheese\nOnStyle']
    out.reWrap = samples.map((s) => {
      const rw = api.reWrapText(s, 36, 'Arial', false, false)
      return { in: s, text: rw.text, fontSize: r3(rw.fontSize) }
    })

    // ---- Fixture 12: custom-prop survival through toObject(CANVAS_CUSTOM_PROPS) ----
    const stamped = new IText('STAMP', { left: 100, top: 100, fontFamily: 'Arial', fontSize: 30 })
    stamped._isSvg = true
    stamped._originalText = 'STAMP'
    stamped._currentColor = '#dd3333'
    stamped._isCurvedText = true
    stamped._uploadSrc = 'https://example.test/upload.png'
    canvas.add(stamped)
    const serialized: any = canvas.toObject(CP)
    const stampedOut = (serialized.objects || []).find((o: any) => o._uploadSrc === 'https://example.test/upload.png')
    out.customProps = {
      survived: CP.reduce((acc: Record<string, boolean>, p: string) => {
        acc[p] = !!stampedOut && Object.prototype.hasOwnProperty.call(stampedOut, p)
        return acc
      }, {}),
    }
    canvas.remove(stamped)

    // ---- Fixture 6: export hashes on a fixed one-object design ----
    // (PNG hash is machine-specific — font rasterization varies by OS/browser —
    //  but the before/after diff runs on the SAME machine, so it's valid there.)
    const fx = new IText('EXPORT', { left: 120, top: 120, fontFamily: 'Arial', fontSize: 40, fill: '#111' })
    canvas.clear()
    canvas.add(fx)
    canvas.renderAll()
    const svg = api.exportCanvasSVG(canvas)
    const png = await api.exportCanvasPNG(canvas, api.shirtImg?.src)
    out.exports = { svgHash: hash(svg), svgLen: svg.length, pngHash: await blobHash(png), jsonHash: hash(JSON.stringify(canvas.toObject(CP))) }
  } finally {
    // Always restore the live canvas exactly as it was.
    canvas.clear()
    if (liveJson.objects?.length) {
      const enlivened = await (fabric as any).util.enlivenObjects(liveJson.objects)
      enlivened.forEach((o: any) => canvas.add(o))
    }
    canvas.renderAll()
  }

  // Download + return, so the operator can save golden-<product>-<side>.json.
  try {
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `parity-${api.productLabel}-${api.currentSide()}.json`
    document.body.appendChild(a); a.click(); a.remove()
    URL.revokeObjectURL(a.href)
  } catch { /* console-only is fine if download is blocked */ }

  return out
}
