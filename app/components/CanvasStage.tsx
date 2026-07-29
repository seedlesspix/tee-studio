'use client'
import { useEffect, type RefObject } from 'react'

type PrintAreaPct = { xPct: number; yPct: number; widthPct: number; heightPct: number }

// CanvasStage — the fixed 680×850 design stage: the color mockup image, the
// Fabric <canvas>, and the dashed print-area overlay, in that exact stacking.
//
// D0 step 1a (move-not-rewrite): extracted VERBATIM from DesignerCanvas. The DOM
// structure, the 680×850 box, and every inline style are byte-identical, so
// getBoundingClientRect() returns the same values and the print-area geometry
// (constrain/wrap/align, all DOM-measured) does NOT shift — the parity gate
// proves this. The parent still owns the canvas lifecycle, geometry, and
// exports, and reaches this DOM through the forwarded refs + the global
// `[data-print-area]` query; the `window._fabricCanvas`/`_printAreaData` bridge
// is untouched. Nothing else splits until parity is green.
export default function CanvasStage({
  canvasRef,
  shirtImgRef,
  printArea,
  onReady,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>
  shirtImgRef: RefObject<HTMLImageElement | null>
  printArea: PrintAreaPct | null
  onReady: (canvas: any) => void
}) {
  // D0 step 2: CanvasStage owns the Fabric canvas LIFECYCLE — creation here,
  // disposal on unmount. The parent wires every handler/control/geometry in its
  // onReady(canvas) callback, invoked once right after creation, preserving the
  // exact create-then-attach order of the original single effect. Fabric is
  // runtime-imported exactly as before; window._fabricCanvas is set by onReady.
  useEffect(() => {
    let canvas: any = null
    let disposed = false
    ;(async () => {
      const { Canvas } = await import('fabric')
      if (disposed || !canvasRef.current) return
      canvas = new Canvas(canvasRef.current, {
        width: 680,
        height: 850,
        backgroundColor: 'transparent',
        preserveObjectStacking: true,
      })
      onReady(canvas)
    })()
    return () => { disposed = true; if (canvas) canvas.dispose() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="relative" style={{ width: 680, height: 850 }}>
      <img
        ref={shirtImgRef}
        alt="Shirt preview"
        crossOrigin="anonymous"
        style={{
          position: 'absolute',
          top: 0, left: 0,
          width: '100%', height: '100%',
          objectFit: 'contain',
          pointerEvents: 'none',
          zIndex: 0,
        }}
      />

      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', top: 0, left: 0 }}
      />
      {printArea && (
        <div data-print-area="true" style={{
          position: 'absolute',
          left: `${printArea.xPct}%`,
          top: `${printArea.yPct}%`,
          width: `${printArea.widthPct}%`,
          height: `${printArea.heightPct}%`,
          border: '1.5px dashed rgba(0,0,0,0.7)',
          borderRadius: '2px',
          pointerEvents: 'none',
          zIndex: 2,
          boxShadow: '0 0 0 1.5px rgba(255,255,255,0.7)',
        }}>

        </div>
      )}
    </div>
  )
}
