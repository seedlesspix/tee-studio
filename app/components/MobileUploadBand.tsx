'use client'
import MyUploadsPanel, { type UploadItem } from './MyUploadsPanel'

// MobileUploadBand — BLOCKER-2 mobile rework, Stage 3. The Upload tool for the
// compact bottom band: a slim upload button + ONE horizontal row of "My Uploads"
// (tap a tile to add, ✕ to remove), plus delete for a selected image. Mobile-only
// — desktop keeps the vertical SelectionPanel upload section (dropzone) untouched.
const ACCEPT = 'image/png,image/jpeg,image/svg+xml,image/webp,application/pdf,.pdf,.svg,.png,.jpg,.jpeg,.webp,.ai,.eps,.psd'

export default function MobileUploadBand({
  handleImageUpload,
  libraryUploads,
  libraryLoading,
  pickLibraryUpload,
  deleteLibraryUpload,
  selectedObjectType,
  deleteSelected,
}: {
  handleImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  libraryUploads: UploadItem[]
  libraryLoading: boolean
  pickLibraryUpload: (item: UploadItem) => void
  deleteLibraryUpload: (id: string) => void
  selectedObjectType: string | null
  deleteSelected: () => void
}) {
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex shrink-0 items-center gap-2">
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-3 py-2 text-sm text-gray-700 transition-colors hover:border-[#dd3333] hover:text-[#dd3333]">
          <span className="text-lg leading-none">⬆</span> Upload image
          <input type="file" accept={ACCEPT} onChange={handleImageUpload} className="hidden" />
        </label>
        <span className="truncate text-[11px] text-gray-400">PNG · SVG · JPG · PDF · AI · EPS · PSD</span>
        {selectedObjectType === 'image' && (
          <button
            type="button"
            onClick={deleteSelected}
            className="ml-auto shrink-0 rounded border border-red-300 px-3 py-1 text-xs text-red-500 transition-colors hover:bg-red-50"
          >
            Delete
          </button>
        )}
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
