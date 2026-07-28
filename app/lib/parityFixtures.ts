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

// Replicates the designer's objectFit:contain letterbox math (DesignerCanvas
// toPct, container 680×850) purely to REPORT the offset spread — this is the
// number that tells us which product genuinely exercises fixture 11.
function letterbox(naturalW: number, naturalH: number, W: number, H: number) {
  const containerAspect = W / H
  const imageAspect = naturalW / naturalH
  if (imageAspect >= containerAspect) {
    const rhFrac = containerAspect / imageAspect
    return {
      naturalW, naturalH,
      imageAspect: r3(imageAspect), containerAspect: r3(containerAspect),
      mode: 'letterbox-top/bottom', renderFrac: r3(rhFrac), offset: r3((1 - rhFrac) / 2),
    }
  }
  const rwFrac = imageAspect / containerAspect
  return {
    naturalW, naturalH,
    imageAspect: r3(imageAspect), containerAspect: r3(containerAspect),
    mode: 'pillarbox-left/right', renderFrac: r3(rwFrac), offset: r3((1 - rwFrac) / 2),
  }
}

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
    // ---- Fixture 11 support: letterbox spread for THIS product's mockup ----
    const img = api.shirtImg
    out.letterbox = img && img.naturalWidth
      ? letterbox(img.naturalWidth, img.naturalHeight, api.container.W, api.container.H)
      : { note: 'shirt image not loaded — reopen after the mockup renders' }

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
