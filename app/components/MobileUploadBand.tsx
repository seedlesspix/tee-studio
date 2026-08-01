'use client'
import MyUploadsPanel, { type UploadItem } from './MyUploadsPanel'

// MobileUploadBand — BLOCKER-2 mobile rework. The Upload tool for the compact
// band, MODE-SWITCHED like Art:
//   • nothing selected → upload button + one horizontal "My Uploads" row.
//   • an image selected → compact EDIT controls (align + Delete).
// Align lives here now (the old top align strip was removed). Mobile-only.
const ACCEPT = 'image/png,image/jpeg,image/svg+xml,image/webp,application/pdf,.pdf,.svg,.png,.jpg,.jpeg,.webp,.ai,.eps,.psd'
const ALIGN: { label: string; title: string; fn: string }[] = [
  { label: '⬛◻◻', title: 'Align Left', fn: 'left' },
  { label: '◻⬛◻', title: 'Align Center', fn: 'center' },
  { label: '◻◻⬛', title: 'Align Right', fn: 'right' },
  { label: '⬆', title: 'Align Top', fn: 'top' },
  { label: '↕', title: 'Align Middle', fn: 'middle' },
  { label: '⬇', title: 'Align Bottom', fn: 'bottom' },
]

export default function MobileUploadBand({
  handleImageUpload,
  libraryUploads,
  libraryLoading,
  pickLibraryUpload,
  deleteLibraryUpload,
  selectedObjectType,
  deleteSelected,
  alignObject,
}: {
  handleImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  libraryUploads: UploadItem[]
  libraryLoading: boolean
  pickLibraryUpload: (item: UploadItem) => void
  deleteLibraryUpload: (id: string) => void
  selectedObjectType: string | null
  deleteSelected: () => void
  alignObject: (fn: string) => void
}) {
  if (selectedObjectType === 'image') {
    return (
      <div className="flex h-full flex-col justify-center px-3">
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
