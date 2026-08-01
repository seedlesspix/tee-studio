'use client'
import ClipartPanel from './ClipartPanel'

// MobileArtBand — BLOCKER-2 mobile rework. The Art (clipart) tool for the compact
// bottom band, MODE-SWITCHED so nothing ever gets clipped:
//   • nothing selected  → the BROWSER (category chips + search + one horizontal
//                          thumbnail row).
//   • a clipart selected → compact EDIT controls (recolour swatches for an SVG +
//                          align + Delete). The browser is hidden while editing, so
//                          the fixed band never has to fit both at once.
// Align lives here now (the old top align strip was removed to stop the shirt
// shrinking twice). Mobile-only — desktop keeps the vertical SelectionPanel.
/* eslint-disable @typescript-eslint/no-explicit-any */
const ALIGN: { label: string; title: string; fn: string }[] = [
  { label: '⬛◻◻', title: 'Align Left', fn: 'left' },
  { label: '◻⬛◻', title: 'Align Center', fn: 'center' },
  { label: '◻◻⬛', title: 'Align Right', fn: 'right' },
  { label: '⬆', title: 'Align Top', fn: 'top' },
  { label: '↕', title: 'Align Middle', fn: 'middle' },
  { label: '⬇', title: 'Align Bottom', fn: 'bottom' },
]

export default function MobileArtBand({
  printMethod,
  onSelect,
  selectedObjectType,
  dbColors,
  recolorSvg,
  selectedSvgColor,
  setSelectedSvgColor,
  deleteSelected,
  alignObject,
}: {
  printMethod: string
  onSelect: (url: string, fileType: string) => void
  selectedObjectType: string | null
  dbColors: any[]
  recolorSvg: (hex: string) => void
  selectedSvgColor: string | null
  setSelectedSvgColor: (hex: string) => void
  deleteSelected: () => void
  alignObject: (fn: string) => void
}) {
  const artSelected = selectedObjectType === 'svg' || selectedObjectType === 'image'

  if (artSelected) {
    const colorList = (dbColors.length > 0 ? dbColors : [
      { label: 'Black', hex: '#000000' }, { label: 'White', hex: '#ffffff' },
    ]) as { label: string; hex: string }[]
    return (
      <div className="flex h-full flex-col justify-center gap-2 px-3">
        {/* Recolour (SVG clipart only) */}
        {selectedObjectType === 'svg' && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {colorList.map(c => (
              <button
                key={c.hex}
                type="button"
                onClick={() => { recolorSvg(c.hex); setSelectedSvgColor(c.hex) }}
                title={c.label}
                style={{ background: c.hex, border: c.hex === '#ffffff' ? '1px solid #999' : 'none' }}
                className={`h-8 w-8 shrink-0 rounded-full ${selectedSvgColor === c.hex ? 'ring-2 ring-gray-900 ring-offset-2 ring-offset-white' : ''}`}
              />
            ))}
          </div>
        )}
        {/* Align + Delete (Delete pinned, always visible) */}
        <div className="flex items-center gap-1.5">
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
            {ALIGN.map(({ label, title, fn }) => (
              <button
                key={fn}
                type="button"
                title={title}
                onPointerDown={e => { e.preventDefault(); alignObject(fn) }}
                className="shrink-0 rounded border border-gray-200 bg-gray-100 px-2 py-1 font-mono text-xs text-gray-800"
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={deleteSelected}
            className="ml-auto shrink-0 rounded border border-red-300 px-3 py-1 text-xs text-red-500 transition-colors hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      </div>
    )
  }

  // Nothing selected → the browser.
  return (
    <div className="h-full">
      <ClipartPanel printMethod={printMethod} onSelect={onSelect} horizontal />
    </div>
  )
}
