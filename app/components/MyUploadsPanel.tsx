'use client'

// Presentational "My Uploads" library strip shown under the designer's upload
// dropzone. State (fetch/persist/delete) lives in DesignerCanvas; this component
// just renders tiles and reports pick/delete. Files are Cloudinary-hosted; the
// tile URL is the Cloudinary image URL.

export type UploadItem = {
  id: string
  url: string
  fileName: string
  fileType: string | null
  width: number | null
  height: number | null
}

type Props = {
  uploads: UploadItem[]
  loading: boolean
  onPick: (item: UploadItem) => void
  onDelete: (id: string) => void
  // Mobile band layout: one horizontal, touch-first row (tap tile = add, always-
  // visible ✕ = remove) instead of the desktop hover grid. Default false → desktop
  // byte-identical.
  horizontal?: boolean
}

export default function MyUploadsPanel({ uploads, loading, onPick, onDelete, horizontal = false }: Props) {
  if (horizontal) {
    return (
      <div className="flex min-h-0 flex-1 items-center gap-2 overflow-x-auto pb-1">
        {loading ? (
          <span className="px-2 text-xs text-gray-400">Loading…</span>
        ) : uploads.length === 0 ? (
          <span className="px-2 text-xs text-gray-400">No uploads yet — add one above.</span>
        ) : (
          uploads.map(item => (
            <div key={item.id} className="relative h-16 w-16 shrink-0 rounded-lg border border-gray-200 bg-white">
              <button
                type="button"
                onClick={() => onPick(item)}
                title={`Add "${item.fileName}"`}
                className="flex h-full w-full items-center justify-center p-1.5"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.url} alt={item.fileName} className="pointer-events-none max-h-full max-w-full object-contain" />
              </button>
              <button
                type="button"
                onClick={() => onDelete(item.id)}
                title="Remove from My Uploads"
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-gray-200 bg-white text-[11px] leading-none text-gray-500 shadow-sm"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    )
  }
  return (
    <div className="mt-6">
      <div className="flex items-center justify-between">
        <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">My Uploads</label>
        {uploads.length > 0 && (
          <span className="text-[10px] text-gray-400 font-mono">{uploads.length}</span>
        )}
      </div>

      {loading ? (
        <p className="mt-3 text-xs text-gray-400 font-mono text-center py-4">Loading…</p>
      ) : uploads.length === 0 ? (
        <div className="mt-2 border border-dashed border-gray-200 rounded-xl px-4 py-6 text-center">
          <p className="text-sm text-gray-500">No uploads yet</p>
          <p className="text-[11px] text-gray-400 mt-1">Images you upload appear here to reuse on any design.</p>
        </div>
      ) : (
        <div className="mt-2 grid grid-cols-3 gap-2">
          {uploads.map(item => (
            <div key={item.id}
              className="group relative aspect-square rounded-lg border border-gray-200 bg-white overflow-hidden">
              {/* Whole tile is the reuse action */}
              <button
                type="button"
                onClick={() => onPick(item)}
                title={`Add "${item.fileName}" to your design`}
                className="absolute inset-0 flex items-center justify-center p-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={item.url} alt={item.fileName}
                  className="max-w-full max-h-full object-contain pointer-events-none" />
                <span className="absolute inset-0 flex items-center justify-center bg-[#dd3333]/85 opacity-0 group-hover:opacity-100 transition-opacity text-white text-[11px] font-bold uppercase tracking-wide">
                  + Add
                </span>
              </button>
              {/* Delete = remove the library entry only (the file is kept) */}
              <button
                type="button"
                onClick={() => onDelete(item.id)}
                title="Remove from My Uploads"
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-white/90 border border-gray-200 text-gray-500 hover:text-white hover:bg-[#dd3333] hover:border-[#dd3333] flex items-center justify-center text-[11px] leading-none shadow-sm opacity-0 group-hover:opacity-100 transition-all">
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
