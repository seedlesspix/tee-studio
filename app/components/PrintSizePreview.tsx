'use client'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ZoomIn } from 'lucide-react'
import { useT } from './StringsProvider'

// PrintSizePreview — "Preview at print size" (Lens 1). Shows a selected RASTER upload rendered at true
// print scale so the customer SEES how sharp (or soft) it will actually print — the visual companion to
// the low-res warning, which only TELLS them a number. The math is the same as the warning's: placed
// inches (from ../lib/lowRes) + the source's natural px → effective DPI. v1 renders at a screen-inch
// approximation (SCREEN_PPI px per print-inch) with a zoom loupe to inspect fine detail; a credit-card
// calibration for exact physical size is a deliberate later add. Raster uploads only — vectors are
// resolution-independent and never trip this (same gate as the warning).

export type PrintPreviewData = {
  src: string          // the hosted upload URL (_uploadSrc) — the file the print pipeline uses
  srcW: number         // natural px of the CURRENT element (post crop / bg-removal)
  srcH: number
  placedInW: number    // placed size on the shirt, inches (worst axis drives the DPI)
  placedInH: number
  dpi: number          // effective DPI at the placed size (Infinity if unknowable)
  tier: 'small' | 'placed' | null // low-res verdict, mirrors the panel warning
}

// Screen pixels per print-inch for the "Actual size" view. ~96 is the CSS reference px/inch — a close
// approximation on most screens. Exact physical size needs per-screen calibration (the later add).
const SCREEN_PPI = 96
// Zoom stops: Fit-to-view, life-size, and two magnifier steps to inspect pixel-level softness.
type ZoomMode = 'fit' | 'actual' | 'x2' | 'x4'
const ZOOM_FACTOR: Record<Exclude<ZoomMode, 'fit'>, number> = { actual: 1, x2: 2, x4: 4 }

export default function PrintSizePreview({
  open, data, onClose,
}: {
  open: boolean
  data: PrintPreviewData | null
  onClose: () => void
}) {
  const t = useT()
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [vp, setVp] = useState({ w: 0, h: 0 })
  const [mode, setMode] = useState<ZoomMode>('actual')
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [loaded, setLoaded] = useState(false)
  const drag = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null)

  // Measure the viewport (drives Fit + pan clamping); re-measure on resize.
  useLayoutEffect(() => {
    if (!open) return
    const measure = () => {
      const el = viewportRef.current
      if (el) setVp({ w: el.clientWidth, h: el.clientHeight })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open])

  // Fresh open: reset to life-size, centered, not-yet-loaded.
  useEffect(() => {
    if (open) { setMode('actual'); setLoaded(false) }
  }, [open, data?.src])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !data) return null

  const baseW = data.placedInW * SCREEN_PPI
  const baseH = data.placedInH * SCREEN_PPI
  // Fit zoom: whole art inside the viewport, capped so a tiny placement doesn't balloon absurdly.
  const fitZoom = vp.w > 0 && vp.h > 0 && baseW > 0 && baseH > 0
    ? Math.min(vp.w / baseW, vp.h / baseH, 4)
    : 1
  const zoom = mode === 'fit' ? fitZoom : ZOOM_FACTOR[mode]
  const dispW = baseW * zoom
  const dispH = baseH * zoom

  // Clamp the image position so it can't be dragged fully out of the viewport. Centered on any axis
  // where the image is smaller than the viewport.
  const clampAxis = (val: number, disp: number, view: number) => {
    if (disp <= view) return (view - disp) / 2
    return Math.min(0, Math.max(view - disp, val))
  }
  const posX = clampAxis(offset.x, dispW, vp.w)
  const posY = clampAxis(offset.y, dispH, vp.h)

  // Re-center whenever zoom/size changes (offset is re-derived from clampAxis; reset the stored offset so
  // a mode switch always starts centered).
  const setModeCentered = (m: ZoomMode) => { setMode(m); setOffset({ x: 0, y: 0 }) }

  const onPointerDown = (e: React.PointerEvent) => {
    if (dispW <= vp.w && dispH <= vp.h) return // nothing to pan
    drag.current = { startX: e.clientX, startY: e.clientY, ox: posX, oy: posY }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    setOffset({ x: d.ox + (e.clientX - d.startX), y: d.oy + (e.clientY - d.startY) })
  }
  const onPointerUp = (e: React.PointerEvent) => {
    drag.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }

  const fmtIn = (n: number) => (Math.round(n * 10) / 10).toString()
  const dpiRounded = Number.isFinite(data.dpi) ? Math.round(data.dpi) : null
  const printsAbout = t('designer.preview.prints_about', 'Prints about {w} × {h} in on the shirt.')
    .replace('{w}', fmtIn(data.placedInW)).replace('{h}', fmtIn(data.placedInH))

  let verdict: string
  let verdictTone: string
  if (data.tier === 'small') {
    verdict = t('designer.preview.verdict_small', 'This file is small ({w}×{h} px) — it may look blocky at any size. A larger file prints sharpest.')
      .replace('{w}', String(data.srcW)).replace('{h}', String(data.srcH))
    verdictTone = 'text-amber-700'
  } else if (data.tier === 'placed') {
    verdict = t('designer.preview.verdict_soft', 'About {dpi} DPI at this size — it may look soft in print. 300 DPI looks sharpest: try making it smaller on the shirt, or email us your original.')
      .replace('{dpi}', String(dpiRounded ?? ''))
    verdictTone = 'text-amber-700'
  } else {
    verdict = dpiRounded != null
      ? t('designer.preview.verdict_sharp', 'About {dpi} DPI at this size — this should print sharp.').replace('{dpi}', String(dpiRounded))
      : ''
    verdictTone = 'text-emerald-700'
  }

  const canPan = dispW > vp.w || dispH > vp.h
  const zoomBtn = (m: ZoomMode, label: string) => (
    <button
      onClick={() => setModeCentered(m)}
      className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
        mode === m ? 'border-gray-800 bg-gray-900 text-white' : 'border-gray-300 text-gray-700 hover:border-gray-400'
      }`}
    >{label}</button>
  )

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden="true" />
      <div role="dialog" aria-label={t('designer.preview.title', 'Preview at print size')}
        className="relative flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-gray-200 px-4 h-12">
          <span className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-gray-900">
            <ZoomIn size={15} strokeWidth={2} /> {t('designer.preview.title', 'Preview at print size')}
          </span>
          <button onClick={onClose} aria-label={t('designer.close', 'Close')}
            className="flex h-7 w-7 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100">✕</button>
        </header>

        <div className="flex flex-col gap-3 p-4">
          {/* The loupe. Checker background reads through transparent PNGs; drag to pan when magnified. */}
          <div
            ref={viewportRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="relative w-full overflow-hidden rounded-lg border border-gray-200 select-none"
            style={{
              height: 'min(60vh, 460px)',
              backgroundColor: '#fff',
              backgroundImage: 'linear-gradient(45deg,#eee 25%,transparent 25%),linear-gradient(-45deg,#eee 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#eee 75%),linear-gradient(-45deg,transparent 75%,#eee 75%)',
              backgroundSize: '16px 16px',
              backgroundPosition: '0 0,0 8px,8px -8px,-8px 0',
              cursor: canPan ? (drag.current ? 'grabbing' : 'grab') : 'default',
              touchAction: 'none',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={data.src}
              alt=""
              draggable={false}
              onLoad={() => setLoaded(true)}
              style={{
                position: 'absolute',
                left: posX, top: posY,
                width: dispW, height: dispH,
                maxWidth: 'none',
                imageRendering: 'auto',
                opacity: loaded ? 1 : 0,
                transition: 'opacity 120ms',
              }}
            />
            {!loaded && (
              <div className="absolute inset-0 flex items-center justify-center text-xs font-mono text-gray-400">
                {t('designer.preview.loading', 'Loading…')}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              {zoomBtn('fit', t('designer.preview.zoom_fit', 'Fit'))}
              {zoomBtn('actual', t('designer.preview.zoom_actual', 'Actual size'))}
              {zoomBtn('x2', '2×')}
              {zoomBtn('x4', '4×')}
            </div>
            {canPan && (
              <span className="text-[11px] text-gray-400">{t('designer.preview.pan_hint', 'Drag to move around')}</span>
            )}
          </div>

          <div className="flex flex-col gap-1 rounded-lg bg-gray-50 px-3 py-2.5">
            <p className="text-[13px] font-medium text-gray-900">{printsAbout}</p>
            {verdict && <p className={`text-xs leading-snug ${verdictTone}`}>{verdict}</p>}
            <p className="mt-0.5 text-[11px] leading-snug text-gray-400">
              {t('designer.preview.screen_note', "“Actual size” is your screen's best estimate of real print size — it can vary a little by screen. Zoom in to inspect fine detail up close.")}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
