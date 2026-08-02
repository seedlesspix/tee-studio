'use client'
import { useEffect, type RefObject } from 'react'
import { Type, Upload, Shapes } from 'lucide-react'

type PrintAreaPct = { xPct: number; yPct: number; widthPct: number; heightPct: number }

// Blank-shirt empty state (Phase 2): CTAs shown ON the mockup when the current
// side is empty; the parent decides whether to show the greeting (front, fully
// blank only) and supplies the three handlers.
type EmptyState = {
  showGreeting: boolean
  onAddText: () => void
  onUpload: () => void
  onAddArt: () => void
}

// CanvasStage — the fixed 680×850 design stage: the color mockup image, the
// Fabric <canvas>, and the dashed print-area overlay, in that exact stacking.
//
// D0 step 1a (move-not-rewrite): extracted VERBATIM from DesignerCanvas. The DOM
// structure, the 680×850 box, and every inline style are byte-identical, so
// getBoundingClientRect() returns the same values and the print-area geometry
// (constrain/wrap/align, all DOM-measured) does NOT shift — the parity gate
// proves this. The parent owns the canvas lifecycle, geometry, and exports, and
// reaches this DOM through the forwarded refs + the global `[data-print-area]`
// query. (1b: the former window._fabricCanvas / _alignObject / _printAreaData
// bridges are now in-component refs in the parent — no window globals.)
export default function CanvasStage({
  canvasRef,
  shirtImgRef,
  printArea,
  onReady,
  emptyState = null,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>
  shirtImgRef: RefObject<HTMLImageElement | null>
  printArea: PrintAreaPct | null
  onReady: (canvas: any) => void
  emptyState?: EmptyState | null
}) {
  // D0 step 2: CanvasStage owns the Fabric canvas LIFECYCLE — creation here,
  // disposal on unmount. The parent wires every handler/control/geometry in its
  // onReady(canvas) callback, invoked once right after creation, preserving the
  // exact create-then-attach order of the original single effect. Fabric is
  // runtime-imported exactly as before; the parent's fabricCanvasRef is set by onReady.
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

      {/* Blank-shirt empty state — greeting + on-garment CTAs, centered on the
          print area. A separate element from [data-print-area] so it never
          affects the DOM-measured print geometry. Hidden the moment anything is
          placed (the parent stops passing emptyState once the side has content). */}
      {emptyState && printArea && (
        <div
          className="absolute z-[3] -translate-x-1/2 -translate-y-1/2"
          style={{
            left: `${printArea.xPct + printArea.widthPct / 2}%`,
            top: `${printArea.yPct + printArea.heightPct / 2}%`,
            pointerEvents: 'auto',
          }}
        >
          <div className="flex w-[220px] flex-col items-center gap-3 rounded-xl bg-white/95 px-5 py-4 text-center shadow-lg ring-1 ring-black/5">
            {emptyState.showGreeting && (
              <div>
                <p className="text-lg font-black tracking-tight text-gray-900">Let&apos;s build it.</p>
                <p className="mt-1 text-xs leading-relaxed text-gray-500">Add text, upload your art, or browse designs to get started.</p>
              </div>
            )}
            <div className="flex w-full flex-col gap-2">
              {/* Three equal start options (red-vocab rule: red = action only, never
                  a pre-selected look). All neutral peers; Add Text leads by order,
                  not colour. */}
              <button
                onClick={emptyState.onAddText}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 transition-colors hover:border-gray-400"
              >
                <Type size={16} strokeWidth={1.75} /> Add Text
              </button>
              <button
                onClick={emptyState.onUpload}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 transition-colors hover:border-gray-400"
              >
                <Upload size={16} strokeWidth={1.75} /> Upload
              </button>
              <button
                onClick={emptyState.onAddArt}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 transition-colors hover:border-gray-400"
              >
                <Shapes size={16} strokeWidth={1.75} /> Add Art
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
