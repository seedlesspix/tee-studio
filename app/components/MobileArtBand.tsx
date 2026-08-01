'use client'
import ClipartPanel from './ClipartPanel'
import MobileAlignRow from './MobileAlignRow'

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
        {/* Align (compact icons) + pinned Delete */}
        <MobileAlignRow alignObject={alignObject} onDelete={deleteSelected} />
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
