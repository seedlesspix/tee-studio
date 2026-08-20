'use client'
import { useEffect, type RefObject } from 'react'
import { Type, Upload, Shapes, Hash } from 'lucide-react'
import { useT } from './StringsProvider'

type PrintAreaPct = { xPct: number; yPct: number; widthPct: number; heightPct: number }

// Blank-shirt empty state (Phase 2): CTAs shown ON the mockup when the current
// side is empty; the parent decides whether to show the greeting (front, fully
// blank only) and supplies the three handlers.
type EmptyState = {
  showGreeting: boolean
  onAddText: () => void
  onUpload?: () => void // omitted in embroidery (no uploads) → the Upload CTA is hidden
  onAddArt?: () => void // omitted on the text-only hat-back → the Add Art CTA is hidden
  onNames?: () => void // omitted in embroidery and when the product template disables N&N
  loggedIn?: boolean // drives the "log in to keep this design" tip (hidden once logged in)
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
  hidePrintAreaBorder = false,
  arcGuide = null,
  referenceGuides = [],
  onReady,
  emptyState = null,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>
  shirtImgRef: RefObject<HTMLImageElement | null>
  printArea: PrintAreaPct | null
  // Keep the [data-print-area] element (geometry measures it) but drop its visible dashed border — used on
  // the hat-back, where the arc guide is the placement cue and the rectangle is just clutter (Denise).
  hidePrintAreaBorder?: boolean
  // Chest reference guide: secondary print areas shown as dashed labelled outlines (placement/size
  // references, e.g. "Left Chest") — not design zones, never priced.
  referenceGuides?: { pct: PrintAreaPct; label: string }[]
  // Type-on-path (Z-hp #2): the drawn arc the customer's hat-back text follows, in 680×850 canvas-px, shown
  // as a subtle dotted guide so they see the line before + while typing. Null off the hat_back zone.
  arcGuide?: { p0: { x: number; y: number }; control: { x: number; y: number }; p2: { x: number; y: number } } | null
  onReady: (canvas: any) => void
  emptyState?: EmptyState | null
}) {
  const t = useT()
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
        alt={t('designer.canvas.shirt_alt', 'Shirt preview')}
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
      {/* Type-on-path arc guide (Z-hp #2): the dotted line the hat-back text follows. A white halo under a
          dark dash so it reads on both light and dark caps, matching the print box's halo treatment. */}
      {arcGuide && (
        <svg width={680} height={850} viewBox="0 0 680 850"
          style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', zIndex: 2 }}>
          {(() => {
            const d = `M ${arcGuide.p0.x} ${arcGuide.p0.y} Q ${arcGuide.control.x} ${arcGuide.control.y} ${arcGuide.p2.x} ${arcGuide.p2.y}`
            return (
              <>
                <path d={d} fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth={4} strokeLinecap="round" />
                <path d={d} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth={1.75} strokeDasharray="5 6" strokeLinecap="round" />
              </>
            )
          })()}
        </svg>
      )}
      {printArea && (
        <div data-print-area="true" style={{
          position: 'absolute',
          left: `${printArea.xPct}%`,
          top: `${printArea.yPct}%`,
          width: `${printArea.widthPct}%`,
          height: `${printArea.heightPct}%`,
          border: hidePrintAreaBorder ? 'none' : '1.5px dashed rgba(0,0,0,0.7)',
          borderRadius: '2px',
          pointerEvents: 'none',
          zIndex: 2,
          boxShadow: hidePrintAreaBorder ? 'none' : '0 0 0 1.5px rgba(255,255,255,0.7)',
        }}>

        </div>
      )}

      {/* Chest reference guide(s): dashed labelled outlines showing where/what-size a secondary print (e.g.
          Left Chest) goes. Reference only — no interaction, not part of the design box. Lighter than the
          main box so it reads as a guide, with a small label chip + white halo for light/dark garments. */}
      {referenceGuides.map((g, i) => (
        <div key={i} style={{
          position: 'absolute',
          left: `${g.pct.xPct}%`, top: `${g.pct.yPct}%`,
          width: `${g.pct.widthPct}%`, height: `${g.pct.heightPct}%`,
          border: '1px dashed rgba(0,0,0,0.45)',
          borderRadius: '2px',
          pointerEvents: 'none',
          zIndex: 2,
          boxShadow: '0 0 0 1px rgba(255,255,255,0.6)',
        }}>
          {g.label && (
            <span style={{
              position: 'absolute', top: -15, left: 0,
              fontSize: 10, lineHeight: '14px', padding: '0 4px', borderRadius: 3,
              background: 'rgba(255,255,255,0.9)', color: 'rgba(0,0,0,0.7)',
              border: '1px solid rgba(0,0,0,0.12)', whiteSpace: 'nowrap',
            }}>{g.label}</span>
          )}
        </div>
      ))}

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
                <p className="text-lg font-black tracking-tight text-gray-900">{t('designer.empty.build_heading', "Let's build it.")}</p>
                <p className="mt-1 text-xs leading-relaxed text-gray-500">{emptyState.onUpload ? t('designer.empty.sub_with_upload', 'Add text, upload your art, or browse designs to get started.') : t('designer.empty.sub_no_upload', 'Add text or browse designs to get started.')}</p>
              </div>
            )}
            <div className="flex w-full flex-col gap-2">
              {/* Start ACTIONS — neutral peers (revert of the #21 red fill, Denise round 2).
                  Red is reserved for the single thin separator below the buttons. Add Text
                  leads by order, not colour. */}
              <button
                onClick={emptyState.onAddText}
                className="flex w-full items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 transition-colors hover:border-gray-400"
              >
                <Type size={16} strokeWidth={1.75} /> {t('designer.empty.add_text', 'Add Text')}
              </button>
              {emptyState.onUpload && (
                <button
                  onClick={emptyState.onUpload}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 transition-colors hover:border-gray-400"
                >
                  <Upload size={16} strokeWidth={1.75} /> {t('designer.empty.upload', 'Upload')}
                </button>
              )}
              {emptyState.onAddArt && (
                <button
                  onClick={emptyState.onAddArt}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 transition-colors hover:border-gray-400"
                >
                  <Shapes size={16} strokeWidth={1.75} /> {t('designer.empty.add_art', 'Add Art')}
                </button>
              )}
              {emptyState.onNames && (
                <button
                  onClick={emptyState.onNames}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 transition-colors hover:border-gray-400"
                >
                  <Hash size={16} strokeWidth={1.75} /> {t('designer.empty.names', 'Names & Numbers')}
                </button>
              )}
            </div>
            {/* Login tip (Denise #25b): distinguishes this-session work from a design saved to your
                account. Hidden once logged in. Wording is admin-editable (Language editor). */}
            {!emptyState.loggedIn && (
              <p className="mt-1 w-full border-t border-[#dd3333] pt-3 text-[11px] font-semibold leading-relaxed text-gray-700">
                {t('designer.empty.login_tip', 'Designing as a guest — your work stays for this visit. Log in to save it to your account and pick it back up next time.')}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
