'use client'
import ClipartPanel from './ClipartPanel'

// MobileArtBand — BLOCKER-2 mobile rework, Stage 3. The Art (clipart) tool for the
// compact bottom band: category chips + search + ONE horizontal thumbnail row
// (ClipartPanel in horizontal mode), plus, when a recolourable SVG clipart is
// selected, a compact colour-swatch row + delete. Mobile-only — desktop keeps the
// vertical SelectionPanel clipart section untouched.
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
}: {
  printMethod: string
  onSelect: (url: string, fileType: string) => void
  selectedObjectType: string | null
  dbColors: any[]
  recolorSvg: (hex: string) => void
  selectedSvgColor: string | null
  setSelectedSvgColor: (hex: string) => void
  deleteSelected: () => void
}) {
  const colorList = (dbColors.length > 0 ? dbColors : [
    { label: 'Black', hex: '#000000' }, { label: 'White', hex: '#ffffff' },
  ]) as { label: string; hex: string }[]
  const artSelected = selectedObjectType === 'svg' || selectedObjectType === 'image'

  return (
    <div className="flex h-full flex-col gap-2">
      {/* Edit controls for a selected clipart — recolour (SVG only) + delete */}
      {artSelected && (
        <div className="flex shrink-0 items-center gap-2 overflow-x-auto">
          {selectedObjectType === 'svg' && colorList.map(c => (
            <button
              key={c.hex}
              type="button"
              onClick={() => { recolorSvg(c.hex); setSelectedSvgColor(c.hex) }}
              title={c.label}
              style={{ background: c.hex, border: c.hex === '#ffffff' ? '1px solid #999' : 'none' }}
              className={`h-8 w-8 shrink-0 rounded-full ${selectedSvgColor === c.hex ? 'ring-2 ring-gray-900 ring-offset-2 ring-offset-white' : ''}`}
            />
          ))}
          <button
            type="button"
            onClick={deleteSelected}
            className="ml-auto shrink-0 rounded border border-red-300 px-3 py-1 text-xs text-red-500 transition-colors hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      )}
      {/* Browser — chips + search + horizontal thumbnail row */}
      <div className="min-h-0 flex-1">
        <ClipartPanel printMethod={printMethod} onSelect={onSelect} horizontal />
      </div>
    </div>
  )
}
