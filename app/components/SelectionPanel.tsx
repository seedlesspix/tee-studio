'use client'
import { type Dispatch, type SetStateAction, type RefObject, type ChangeEventHandler } from 'react'
import ClipartPanel from './ClipartPanel'
import MyUploadsPanel, { type UploadItem } from './MyUploadsPanel'

// SelectionPanel — the designer's LEFT TOOL PANEL BODY (Text / Upload / Clipart).
//
// A DUMB VIEW over parent-owned canvas logic — every value/setter/handler
// arrives as a prop, grouped by domain (text / upload / clipart) plus the shared
// activeTab / dbColors / deleteSelected. ALL logic stays in the parent: the
// style/size/curve push effects, the selection handlers that mirror the object
// into these knobs (reflectTextObject), spawn/curve/fit/recolor, _activeObj.
//
// SELECTION-DRIVEN (Phase 2 inversion): `panelMode` below chooses what shows off
// the SELECTED object first, falling back to the rail's activeTab only when
// nothing is selected. Selection = EDIT (text / art-edit / image-edit); rail =
// ADD (text box / upload / clipart browser). This retired the old tab-driven
// keying AND closed the reflection gap the D0 backstop found: selecting a text
// now mirrors ITS font/size/COLOR/spacing/etc. into the knobs (parent's
// reflectTextObject), not just clipart color — and that mirror also fixed the
// latent "touch one knob → text snaps to panel defaults" clobber.
//
// Remaining follow-ups (still logged, NOT this pass): the two-panel split; a
// DesignerContext refactor once prop-drilling hurts (retire this bundle); the
// dbColors fallback literal still appears a few times.
type SelectionPanelProps = {
  activeTab: string
  dbColors: any[]
  deleteSelected: () => void
  text: {
    textInput: string
    textInputRef: RefObject<HTMLTextAreaElement | null>
    handleTextInputChange: (value: string) => void
    selectedObjectType: 'text' | 'image' | 'svg' | null
    startNewText: () => void
    dbFonts: any[]
    fonts: any[]
    selectedFont: string
    setSelectedFont: Dispatch<SetStateAction<string>>
    selectedTextPreview: string
    fontSize: number
    setFontSize: Dispatch<SetStateAction<number>>
    letterSpacing: number
    setLetterSpacing: Dispatch<SetStateAction<number>>
    textColor: string
    setTextColor: Dispatch<SetStateAction<string>>
    textDirection: string
    setTextDirection: (v: 'horizontal' | 'vertical') => void
    curveAmount: number
    setCurveAmount: Dispatch<SetStateAction<number>>
    textIsMultiline: boolean
    textAlign: string
    handleTextAlign: (align: 'left' | 'center' | 'right') => void
    isBold: boolean
    setIsBold: Dispatch<SetStateAction<boolean>>
    isItalic: boolean
    setIsItalic: Dispatch<SetStateAction<boolean>>
    isUppercase: boolean
    setIsUppercase: Dispatch<SetStateAction<boolean>>
  }
  upload: {
    handleImageUpload: ChangeEventHandler<HTMLInputElement>
    libraryUploads: UploadItem[]
    libraryLoading: boolean
    pickLibraryUpload: (item: UploadItem) => void
    deleteLibraryUpload: (id: string) => void
  }
  clipart: {
    printMethod: string
    handleClipartSelect: (url: string, fileType: string) => void
    recolorSvg: (hex: string) => void
    setSelectedSvgColor: Dispatch<SetStateAction<string>>
    selectedSvgColor: string
  }
}

export default function SelectionPanel({
  activeTab,
  dbColors,
  deleteSelected,
  text,
  upload,
  clipart,
}: SelectionPanelProps) {
  const {
    textInput, textInputRef, handleTextInputChange, selectedObjectType, startNewText,
    dbFonts, fonts, selectedFont, setSelectedFont, selectedTextPreview,
    fontSize, setFontSize, letterSpacing, setLetterSpacing, textColor, setTextColor,
    textDirection, setTextDirection, curveAmount, setCurveAmount, textIsMultiline,
    textAlign, handleTextAlign, isBold, setIsBold, isItalic, setIsItalic,
    isUppercase, setIsUppercase,
  } = text
  const { handleImageUpload, libraryUploads, libraryLoading, pickLibraryUpload, deleteLibraryUpload } = upload
  const { printMethod, handleClipartSelect, recolorSvg, setSelectedSvgColor, selectedSvgColor } = clipart
  // Selection-driven (Phase 2 inversion): what the panel shows follows the
  // SELECTED object, falling back to the rail's active tab only when nothing is
  // selected. Selection WINS for editing (text / art-edit / image-edit); the
  // rail drives ADDING (text box / upload / clipart browser). The text mode
  // serves both — the box is empty to add, filled+reflected to edit.
  const panelMode =
    selectedObjectType === 'text' ? 'text'
    : selectedObjectType === 'svg' ? 'art-edit'
    : selectedObjectType === 'image' ? 'image-edit'
    : activeTab
  return (
          <div className="px-4 pb-4 flex flex-col gap-4">

                        {/* TEXT — add (empty box) + edit (reflects the selected text) */}
            {panelMode === 'text' && (
              <>
                {/* The box is the typing surface — always live. The first
                    keystroke puts the text on the shirt; no button hunt. */}
                <div>
                  <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">Your Text</label>
                  <textarea value={textInput} ref={textInputRef} rows={3}
                    onChange={e => handleTextInputChange(e.target.value)}
                    placeholder="Type something...&#10;Press Enter for a new line"
                    className="w-full mt-1 bg-gray-100 border border-gray-200 rounded px-3 py-2 text-sm text-gray-900 outline-none focus:border-[#dd3333] resize-y leading-snug"
                  />
                  {/* Teaches the quicker path, and only once it's useful. */}
                  {selectedObjectType === 'text' && (
                    <p className="mt-1.5 text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded px-2 py-1.5 leading-relaxed">
                      Or <span className="font-semibold text-gray-700">double-click</span> the text on the shirt to edit it here.
                    </p>
                  )}
                </div>
                {/* Only shown when a text is selected — the one state where the
                    box is occupied and "start a new one" isn't obvious. With
                    nothing selected the box already starts a new text, so the
                    button would be noise. */}
                {selectedObjectType === 'text' && (
                  <button onClick={startNewText}
                    className="w-full border border-gray-300 text-gray-800 py-2 rounded text-sm hover:border-[#dd3333] hover:text-[#dd3333] transition-colors">
                    + Add another text
                  </button>
                )}
                <div>
                  <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">Font</label>
                  <div className="flex flex-col gap-1 mt-1 max-h-48 overflow-y-auto pr-1">
                    {(dbFonts.length > 0 ? dbFonts : fonts).map(f => (
                      <button key={f.value} onClick={() => setSelectedFont(f.value)}
                        className={`w-full text-left px-3 py-2 rounded border transition-all ${
                          selectedFont === f.value
                            ? 'border-[#dd3333] bg-[#dd3333]/10'
                            : 'border-gray-200 bg-gray-100 hover:border-[#444]'
                        }`}>
                        <div className="text-xs text-gray-800 font-mono mb-0.5">{f.label}</div>
                        <div style={{ fontFamily: f.value, fontSize: '18px', color: '#161616', lineHeight: 1.2 }}>
                          {selectedTextPreview || textInput || 'Preview Text'}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="flex justify-between items-center">
                    <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">Size</label>
                    <input type="number" min={8} max={120} value={fontSize}
                      onChange={e => setFontSize(Number(e.target.value))}
                      className="w-14 bg-gray-100 border border-gray-200 rounded px-2 py-1 text-xs text-gray-900 outline-none text-center focus:border-[#dd3333]"
                    />
                  </div>
                  <input type="range" min={8} max={120} value={fontSize}
                    onChange={e => setFontSize(Number(e.target.value))}
                    className="w-full mt-1 accent-[#dd3333]" />
                </div>
                <div>
                  <div className="flex justify-between items-center">
                    <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">Letter Spacing</label>
                    <span className="text-xs text-[#dd3333] font-mono">{letterSpacing}</span>
                  </div>
                  <input type="range" min={-5} max={30} value={letterSpacing}
                    onChange={e => setLetterSpacing(Number(e.target.value))}
                    className="w-full mt-1 accent-[#dd3333]" />
                </div>
                <div>
                  <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">Text Color</label>
                  <div className="flex gap-2 mt-2 flex-wrap items-center">
                    {(dbColors.length > 0 ? dbColors : [
                      { label: 'White', hex: '#ffffff' },
                      { label: 'Black', hex: '#000000' },
                    ]).map(c => (
                      <button key={c.hex} onClick={() => setTextColor(c.hex)}
                        title={c.label}
                        style={{
                          background: c.hex,
                          border: c.hex === '#ffffff' ? '1px solid #555' : 'none'
                        }}
                        className={`w-8 h-8 rounded-full transition-transform hover:scale-110 ${
                          textColor === c.hex
                            ? 'ring-2 ring-[#dd3333] ring-offset-1 ring-offset-[#161616]'
                            : ''
                        }`}
                      />
                    ))}
                    <input type="color" value={textColor}
                      onChange={e => setTextColor(e.target.value)}
                      className="w-8 h-8 rounded-full cursor-pointer overflow-hidden"
                      title="Custom color" />
                  </div>
                  {dbColors.length > 0 && (
                    <p className="text-xs text-gray-800 mt-1 font-mono">
                      {dbColors.find(c => c.hex === textColor)?.label || 'Custom'}
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">Direction</label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <button onClick={() => setTextDirection('horizontal')}
                      className={`py-2 rounded text-xs font-mono transition-all ${textDirection === 'horizontal' ? 'bg-[#dd3333] text-white' : 'bg-gray-100 text-gray-800 border border-gray-200'}`}>
                      — Horizontal
                    </button>
                    <button onClick={() => setTextDirection('vertical')}
                      className={`py-2 rounded text-xs font-mono transition-all ${textDirection === 'vertical' ? 'bg-[#dd3333] text-white' : 'bg-gray-100 text-gray-800 border border-gray-200'}`}>
                      ↕ Vertical
                    </button>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between items-center">
                    <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">Curve</label>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-800 font-mono">{curveAmount > 0 ? `+${curveAmount}` : curveAmount}</span>
                      <button onClick={() => setCurveAmount(0)} disabled={textIsMultiline}
                        className={`text-[10px] px-2 py-0.5 rounded font-mono transition-all ${
                          textIsMultiline ? 'bg-gray-100 text-gray-400 cursor-default'
                            : curveAmount !== 0 ? 'bg-[#dd3333] text-white' : 'bg-gray-200 text-gray-800'
                        }`}>
                        Straight
                      </button>
                    </div>
                  </div>
                  <input type="range" min="-100" max="100" value={curveAmount}
                    onChange={e => setCurveAmount(Number(e.target.value))}
                    disabled={textIsMultiline}
                    className="w-full mt-1 accent-[#dd3333] disabled:opacity-40" />
                  {textIsMultiline ? (
                    /* The arc renderer lays every character along ONE arc, so a
                       stacked design would silently collapse into a single line. */
                    <p className="text-[10px] text-gray-500 mt-1">Curve works on single-line text.</p>
                  ) : (
                    <div className="flex justify-between text-[9px] text-gray-800 font-mono mt-0.5">
                      <span>⌣ Down</span>
                      <span>|</span>
                      <span>⌢ Up</span>
                    </div>
                  )}
                </div>
                <div>
                  <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">Text Align</label>
                  <div className="flex gap-1">
                    {(['left', 'center', 'right'] as const).map(align => (
                      <button key={align}
                        onClick={() => handleTextAlign(align)}
                        className={`flex-1 py-1.5 rounded text-xs font-mono border transition-all ${
                          textAlign === align
                            ? 'bg-[#dd3333] text-white border-[#dd3333]'
                            : 'bg-white text-gray-700 border-gray-200 hover:border-[#dd3333]'
                        }`}>
                        {align === 'left' ? (
                          <svg width="14" height="12" viewBox="0 0 14 12" fill="currentColor">
                            <rect x="0" y="0" width="14" height="2"/>
                            <rect x="0" y="5" width="10" height="2"/>
                            <rect x="0" y="10" width="12" height="2"/>
                          </svg>
                        ) : align === 'center' ? (
                          <svg width="14" height="12" viewBox="0 0 14 12" fill="currentColor">
                            <rect x="0" y="0" width="14" height="2"/>
                            <rect x="2" y="5" width="10" height="2"/>
                            <rect x="1" y="10" width="12" height="2"/>
                          </svg>
                        ) : (
                          <svg width="14" height="12" viewBox="0 0 14 12" fill="currentColor">
                            <rect x="0" y="0" width="14" height="2"/>
                            <rect x="4" y="5" width="10" height="2"/>
                            <rect x="2" y="10" width="12" height="2"/>
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                  <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">Effects</label>
                  <div className="grid grid-cols-3 gap-2 mt-1">
                    <button onClick={() => setIsBold(b => !b)}
                      className={`py-2 rounded text-xs font-bold transition-all ${isBold ? 'bg-[#dd3333] text-white' : 'bg-gray-100 text-gray-800 border border-gray-200'}`}>
                      Bold
                    </button>
                    <button onClick={() => setIsItalic(i => !i)}
                      className={`py-2 rounded text-xs italic transition-all ${isItalic ? 'bg-[#dd3333] text-white' : 'bg-gray-100 text-gray-800 border border-gray-200'}`}>
                      Italic
                    </button>
                    <button onClick={() => setIsUppercase(u => !u)}
                      className={`py-2 rounded text-xs font-mono transition-all ${isUppercase ? 'bg-[#dd3333] text-white' : 'bg-gray-100 text-gray-800 border border-gray-200'}`}>
                      AA
                    </button>

                  </div>
                </div>
                {/* Delete belongs to EDIT, not the empty add-surface. */}
                {selectedObjectType === 'text' && (
                  <button onClick={deleteSelected}
                    className="w-full border border-red-800 text-red-400 py-2 rounded text-sm hover:bg-red-900/20 transition-colors">
                    Delete Selected
                  </button>
                )}
              </>
            )}
            {/* UPLOAD — add-surface (dropzone + library) */}
            {panelMode === 'upload' && (
              <div>
                <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">Upload Artwork</label>
                <label className="mt-2 flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-xl p-8 cursor-pointer hover:border-[#dd3333] hover:bg-[#dd3333]/5 transition-all">
                  <span className="text-3xl mb-3">⬆</span>
                  <span className="text-sm text-gray-800 text-center">
                    Drop image here<br />
                    <span className="text-xs opacity-60">PNG, SVG, JPG, JPEG, PDF</span>
                    <span className="text-[10px] opacity-40 mt-0.5 block">AI · EPS · PSD supported via Cloudinary</span>
                  </span>
                  <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp,application/pdf,.pdf,.svg,.png,.jpg,.jpeg,.webp,.ai,.eps,.psd" onChange={handleImageUpload} className="hidden" />
                </label>
                <MyUploadsPanel
                  uploads={libraryUploads}
                  loading={libraryLoading}
                  onPick={pickLibraryUpload}
                  onDelete={deleteLibraryUpload}
                />
              </div>
            )}

            {/* CLIPART — add-surface (browser). Selecting a clipart swaps to
                art-edit below, so the browser is hidden while one is selected;
                click the Art rail again to browse for another. */}
            {panelMode === 'clipart' && (
              <div className="flex flex-col gap-3">
                <ClipartPanel
                  printMethod={printMethod}
                  onSelect={handleClipartSelect}
                />
              </div>
            )}

            {/* ART edit — a clipart/SVG is selected: recolor + delete. */}
            {panelMode === 'art-edit' && (
              <div className="flex flex-col gap-3">
                {/* SVG Color swatches */}
                <div className="mt-2">
                  <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">Clipart Color</label>
                  <div className="flex gap-2 mt-2 flex-wrap items-center">
                    {(dbColors.length > 0 ? dbColors : [
                      { label: 'Black', hex: '#000000' },
                      { label: 'White', hex: '#ffffff' },
                    ]).map(c => (
                      <button key={c.hex} onClick={() => { recolorSvg(c.hex); setSelectedSvgColor(c.hex) }}
                        title={c.label}
                        style={{ background: c.hex, border: c.hex === '#ffffff' ? '1px solid #555' : 'none' }}
                        className={`w-8 h-8 rounded-full transition-transform hover:scale-110 ${
                          selectedSvgColor === c.hex ? 'ring-2 ring-[#dd3333] ring-offset-2 ring-offset-[#161616]' : ''
                        }`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-gray-800 mt-1 font-mono">
                    {(dbColors.length > 0 ? dbColors : [{ label: 'Black', hex: '#000000' }, { label: 'White', hex: '#ffffff' }]).find(c => c.hex === selectedSvgColor)?.label || selectedSvgColor || 'Black'}
                  </p>
                </div>
                <button onClick={deleteSelected}
                  className="w-full border border-red-800 text-red-400 py-2 rounded text-sm hover:bg-red-900/20 transition-colors mt-2">
                  Delete Selected
                </button>
              </div>
            )}

            {/* IMAGE edit — a raster upload is selected. No per-object controls
                exist for rasters (no recolor), so this is delete only. Curved
                text lands here too (it's baked to an image), which is why it
                can't be re-edited as text — a known, documented limitation. */}
            {panelMode === 'image-edit' && (
              <button onClick={deleteSelected}
                className="w-full border border-red-800 text-red-400 py-2 rounded text-sm hover:bg-red-900/20 transition-colors">
                Delete Selected
              </button>
            )}

          </div>
  )
}
