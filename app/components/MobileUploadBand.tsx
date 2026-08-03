'use client'
import MyUploadsPanel, { type UploadItem } from './MyUploadsPanel'
import MobileAlignRow from './MobileAlignRow'

// MobileUploadBand — BLOCKER-2 mobile rework. The Upload tool for the compact
// band, MODE-SWITCHED like Art:
//   • nothing selected → upload button + one horizontal "My Uploads" row.
//   • an image selected → compact EDIT controls (align + Delete).
// Align lives here now (the old top align strip was removed). Mobile-only.
const ACCEPT = 'image/png,image/jpeg,image/svg+xml,image/webp,application/pdf,.pdf,.svg,.png,.jpg,.jpeg,.webp,.ai,.eps,.psd'

export default function MobileUploadBand({
  handleImageUpload,
  libraryUploads,
  libraryLoading,
  pickLibraryUpload,
  deleteLibraryUpload,
  selectedObjectType,
  deleteSelected,
  alignObject,
  removeWhite,
  eyedropperActive,
  setEyedropperActive,
  removeColorTol,
  setRemoveColorTol,
  imageEditBusy,
  colorPreview,
  applyColorRemoval,
  cancelColorRemoval,
}: {
  handleImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  libraryUploads: UploadItem[]
  libraryLoading: boolean
  pickLibraryUpload: (item: UploadItem) => void
  deleteLibraryUpload: (id: string) => void
  selectedObjectType: string | null
  deleteSelected: () => void
  alignObject: (fn: string) => void
  removeWhite: () => void
  eyedropperActive: boolean
  setEyedropperActive: React.Dispatch<React.SetStateAction<boolean>>
  removeColorTol: number
  setRemoveColorTol: React.Dispatch<React.SetStateAction<number>>
  imageEditBusy: boolean
  colorPreview: boolean
  applyColorRemoval: () => void
  cancelColorRemoval: () => void
}) {
  if (selectedObjectType === 'image') {
    return (
      <div className="flex h-full flex-col justify-center gap-2 px-3">
        {colorPreview ? (
          <div className="flex flex-col gap-2">
            <input type="range" min={5} max={100} value={removeColorTol}
              onChange={e => setRemoveColorTol(Number(e.target.value))}
              className="w-full accent-[#dd3333]" aria-label="Color match tolerance" />
            <div className="flex gap-2">
              <button onClick={applyColorRemoval} disabled={imageEditBusy}
                className="flex-1 rounded-lg bg-[#dd3333] py-2 text-sm text-white disabled:opacity-50">Apply</button>
              <button onClick={cancelColorRemoval} disabled={imageEditBusy}
                className="flex-1 rounded-lg border border-gray-300 py-2 text-sm text-gray-700 disabled:opacity-50">Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <button onClick={removeWhite} disabled={imageEditBusy}
                className="flex-1 rounded-lg border border-gray-300 py-2 text-sm text-gray-700 disabled:opacity-50">
                Remove White
              </button>
              <button onClick={() => setEyedropperActive(v => !v)} disabled={imageEditBusy}
                className={`flex-1 rounded-lg border py-2 text-sm disabled:opacity-50 ${
                  eyedropperActive ? 'border-gray-800 bg-gray-200 text-gray-900' : 'border-gray-300 text-gray-700'
                }`}>
                {eyedropperActive ? 'Tap the color…' : 'Remove a Color'}
              </button>
            </div>
            <MobileAlignRow alignObject={alignObject} onDelete={deleteSelected} />
          </>
        )}
      </div>
    )
  }

  // Nothing selected → upload + library.
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex shrink-0 items-center gap-2">
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:border-[#dd3333] hover:text-[#dd3333]">
          <span className="text-lg leading-none">⬆</span> Upload image
          <input type="file" accept={ACCEPT} onChange={handleImageUpload} className="hidden" />
        </label>
        <span className="truncate text-[11px] text-gray-400">PNG · SVG · JPG · PDF · AI · EPS · PSD</span>
      </div>
      <MyUploadsPanel
        uploads={libraryUploads}
        loading={libraryLoading}
        onPick={pickLibraryUpload}
        onDelete={deleteLibraryUpload}
        horizontal
      />
    </div>
  )
}
