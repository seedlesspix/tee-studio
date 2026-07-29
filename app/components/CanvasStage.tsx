'use client'
import type { RefObject } from 'react'

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
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>
  shirtImgRef: RefObject<HTMLImageElement | null>
  printArea: PrintAreaPct | null
}) {
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
