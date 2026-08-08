'use client'
import MyUploadsPanel, { type UploadItem } from './MyUploadsPanel'
import MobileAlignRow from './MobileAlignRow'
import { useT } from './StringsProvider'

// MobileUploadBand — BLOCKER-2 mobile rework. The Upload tool for the compact
// band, MODE-SWITCHED like Art:
//   • nothing selected → upload button + one horizontal "My Uploads" row.
//   • an image selected → compact EDIT controls (align + Delete).
// Align lives here now (the old top align strip was removed). Mobile-only.
const ACCEPT = 'image/png,image/jpeg,image/svg+xml,image/webp,application/pdf,.pdf,.svg,.png,.jpg,.jpeg,.webp,.ai,.psd'

export default function MobileUploadBand({
  handleImageUpload,
  uploadGuidance,
  libraryUploads,
  libraryLoading,
  pickLibraryUpload,
  deleteLibraryUpload,
  selectedObjectType,
  deleteSelected,
  alignObject,
  removeWhite,
  removeBackground,
  eyedropperActive,
  setEyedropperActive,
  removeColorTol,
  setRemoveColorTol,
  imageEditBusy,
  colorPreview,
  applyColorRemoval,
  cancelColorRemoval,
  startCrop,
  cropMode,
  applyCrop,
  cancelCrop,
  lowResWarning,
}: {
  handleImageUpload: (e: React.ChangeEvent<HTMLInputElement>) => void
  uploadGuidance: string
  libraryUploads: UploadItem[]
  libraryLoading: boolean
  pickLibraryUpload: (item: UploadItem) => void
  deleteLibraryUpload: (id: string) => void
  selectedObjectType: string | null
  deleteSelected: () => void
  alignObject: (fn: string) => void
  removeWhite: () => void
  removeBackground: () => void
  eyedropperActive: boolean
  setEyedropperActive: React.Dispatch<React.SetStateAction<boolean>>
  removeColorTol: number
  setRemoveColorTol: React.Dispatch<React.SetStateAction<number>>
  imageEditBusy: boolean
  colorPreview: boolean
  applyColorRemoval: () => void
  cancelColorRemoval: () => void
  startCrop: () => void
  cropMode: boolean
  applyCrop: () => void
  cancelCrop: () => void
  lowResWarning?: string | null
}) {
  const t = useT()
  if (selectedObjectType === 'image') {
    return (
      <div className="flex h-full flex-col justify-center gap-2 overflow-y-auto px-3">
        {lowResWarning && (
          <p className="rounded border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-800">
            {lowResWarning}
          </p>
        )}
        {cropMode ? (
          <div className="flex gap-2">
            <button onClick={applyCrop} disabled={imageEditBusy}
              className="flex-1 rounded-lg bg-[#dd3333] py-2 text-sm text-white disabled:opacity-50">{t('designer.upload.apply_crop', 'Apply Crop')}</button>
            <button onClick={cancelCrop} disabled={imageEditBusy}
              className="flex-1 rounded-lg border border-gray-300 py-2 text-sm text-gray-700 disabled:opacity-50">{t('designer.upload.cancel_crop', 'Cancel')}</button>
          </div>
        ) : colorPreview ? (
          <div className="flex flex-col gap-2">
            <input type="range" min={5} max={100} value={removeColorTol}
              onChange={e => setRemoveColorTol(Number(e.target.value))}
              className="w-full accent-[#dd3333]" aria-label={t('designer.upload.tolerance_aria', 'Color match tolerance')} />
            <div className="flex gap-2">
              <button onClick={applyColorRemoval} disabled={imageEditBusy}
                className="flex-1 rounded-lg bg-[#dd3333] py-2 text-sm text-white disabled:opacity-50">{t('designer.upload.apply_color', 'Apply')}</button>
              <button onClick={cancelColorRemoval} disabled={imageEditBusy}
                className="flex-1 rounded-lg border border-gray-300 py-2 text-sm text-gray-700 disabled:opacity-50">{t('designer.upload.cancel_color', 'Cancel')}</button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={removeBackground} disabled={imageEditBusy}
                className="rounded-lg border border-gray-300 py-2 text-sm text-gray-700 disabled:opacity-50">{t('designer.upload.remove_background', 'Remove Background')}</button>
              <button onClick={removeWhite} disabled={imageEditBusy}
                className="rounded-lg border border-gray-300 py-2 text-sm text-gray-700 disabled:opacity-50">{t('designer.upload.remove_white', 'Remove White')}</button>
              <button onClick={() => setEyedropperActive(v => !v)} disabled={imageEditBusy}
                className={`rounded-lg border py-2 text-sm disabled:opacity-50 ${
                  eyedropperActive ? 'border-gray-800 bg-gray-200 text-gray-900' : 'border-gray-300 text-gray-700'
                }`}>
                {eyedropperActive ? t('designer.upload.eyedropper_active_mobile', 'Tap the color…') : t('designer.upload.remove_color', 'Remove a Color')}
              </button>
              <button onClick={startCrop} disabled={imageEditBusy}
                className="rounded-lg border border-gray-300 py-2 text-sm text-gray-700 disabled:opacity-50">{t('designer.upload.crop', 'Crop…')}</button>
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
          <span className="text-lg leading-none">⬆</span> {t('designer.upload.upload_image', 'Upload image')}
          <input type="file" accept={ACCEPT} onChange={handleImageUpload} className="hidden" />
        </label>
        <span className="truncate text-[11px] text-gray-400">{t('designer.upload.formats', 'JPG · PNG · SVG · AI · PSD · PDF')}</span>
      </div>
      <p className="shrink-0 text-[11px] leading-snug text-gray-400">{uploadGuidance}</p>
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
