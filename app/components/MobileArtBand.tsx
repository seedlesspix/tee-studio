'use client'
import ClipartPanel, { type ArtMeta } from './ClipartPanel'
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
  onSelect: (url: string, fileType: string, meta?: ArtMeta) => void
  selectedObjectType: string | null
  dbColors: any[]
  recolorSvg: (hex: string) => void
  selectedSvgColor: string | null
  setSelectedSvgColor: (hex: string) => void
  deleteSelected: () => void
  alignObject: (fn: string) => void
}) {
  const artSelected = selectedObjectType === 'svg' || selectedObjectType === 'image'
  const colorList = (dbColors.length > 0 ? dbColors : [
    { label: 'Black', hex: '#000000' }, { label: 'White', hex: '#ffffff' },
  ]) as { label: string; hex: string }[]

  // The browser (clipart row) STAYS visible even while editing — a slim edit row
  // just layers above it (recolour for SVG + compact align + Delete). The search box
  // hides while editing so the thumbnail row keeps its height (no clip). Nothing
  // selected → full browser (with search).
  return (
    <div className="flex h-full flex-col gap-1.5 px-3 pt-2">
      {artSelected && (
        <div className="flex shrink-0 flex-col gap-1.5">
          {selectedObjectType === 'svg' && (
            <div className="flex items-center gap-1.5 overflow-x-auto">
              {colorList.map(c => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => { recolorSvg(c.hex); setSelectedSvgColor(c.hex) }}
                  title={c.label}
                  style={{ background: c.hex, border: c.hex === '#ffffff' ? '1px solid #999' : 'none' }}
                  className={`h-7 w-7 shrink-0 rounded-full ${selectedSvgColor === c.hex ? 'ring-2 ring-gray-900 ring-offset-1 ring-offset-white' : ''}`}
                />
              ))}
            </div>
          )}
          <MobileAlignRow alignObject={alignObject} onDelete={deleteSelected} />
        </div>
      )}
      <div className="min-h-0 flex-1">
        <ClipartPanel printMethod={printMethod} onSelect={onSelect} horizontal showSearch={!artSelected} />
      </div>
    </div>
  )
}
