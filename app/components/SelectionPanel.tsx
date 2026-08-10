'use client'
import { type Dispatch, type SetStateAction, type RefObject, type ChangeEventHandler, type DragEventHandler } from 'react'
import { AlignLeft, AlignCenter, AlignRight, AlignJustify, Bold, Italic, CaseUpper, MoveHorizontal, MoveVertical, Upload } from 'lucide-react'
import ClipartPanel, { type ArtMeta } from './ClipartPanel'
import MyUploadsPanel, { type UploadItem } from './MyUploadsPanel'
import FontPicker from './FontPicker'
import { useT } from './StringsProvider'

// SelectionPanel — the designer's LEFT TOOL PANEL BODY (Text / Upload / Clipart).
//
// A DUMB VIEW over parent-owned canvas logic — every value/setter/handler
// arrives as a prop, grouped by domain (text / upload / clipart) plus the shared
// activeTab / dbColors / deleteSelected. ALL logic stays in the parent: the
// style/size/curve push effects, the selection handlers that mirror the object
// into these knobs (reflectTextObject), spawn/curve/fit/recolor, _activeObj.
//
// SELECTION-DRIVEN (Phase 2): the panel renders by SECTION (activeTab). The
// parent sets activeTab to the selected object's section on select, so the rail
// highlight and this panel always agree on "what am I editing" — no panelMode
// override, they read the same activeTab. Each section shows its ADD surface
// always (text box / upload dropzone+library / clipart browser); the EDIT
// controls activate when an object of that section is selected:
//   • Text  — the knobs mirror the selected text (font/size/COLOR/spacing/…) via
//     the parent's reflectTextObject (also fixed the latent "touch one knob →
//     text snaps to defaults" clobber); Delete when a text is selected.
//   • Art   — browser stays put; Color swatches on an SVG (recolorable), Delete
//     on any selected art (SVG or raster clipart).
//   • Upload— dropzone + library stay put; Delete on a selected image.
//
// Remaining follow-ups (logged, NOT this pass): the PANEL red-sweep (selected
// font border, color-swatch ring, active buttons → quiet); the two-panel split;
// a DesignerContext refactor once prop-drilling hurts; Delete is repeated per
// section (inherent to per-section render) and the dbColors fallback literal too.
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
    lineHeight: number
    setLineHeight: Dispatch<SetStateAction<number>>
    textColor: string
    setTextColor: Dispatch<SetStateAction<string>>
    textDirection: string
    setTextDirection: (v: 'horizontal' | 'vertical') => void
    curveAmount: number
    setCurveAmount: Dispatch<SetStateAction<number>>
    textIsMultiline: boolean
    textAlign: string
    handleTextAlign: (align: 'left' | 'center' | 'right' | 'justify') => void
    isBold: boolean
    setIsBold: Dispatch<SetStateAction<boolean>>
    isItalic: boolean
    setIsItalic: Dispatch<SetStateAction<boolean>>
    isUppercase: boolean
    setIsUppercase: Dispatch<SetStateAction<boolean>>
  }
  upload: {
    handleImageUpload: ChangeEventHandler<HTMLInputElement>
    handleImageDrop: DragEventHandler
    uploadGuidance: string
    libraryUploads: UploadItem[]
    libraryLoading: boolean
    pickLibraryUpload: (item: UploadItem) => void
    deleteLibraryUpload: (id: string) => void
    removeWhite: () => void
    removeBackground: () => void
    eyedropperActive: boolean
    setEyedropperActive: Dispatch<SetStateAction<boolean>>
    removeColorTol: number
    setRemoveColorTol: Dispatch<SetStateAction<number>>
    imageEditBusy: boolean
    colorPreview: boolean
    applyColorRemoval: () => void
    cancelColorRemoval: () => void
    startCrop: () => void
    cropMode: boolean
    applyCrop: () => void
    cancelCrop: () => void
    // Low-res nudge for the selected raster upload (null = fine). Never blocks. See LOWRES_* in DesignerCanvas.
    lowResWarning?: string | null
  }
  clipart: {
    printMethod: string
    handleClipartSelect: (url: string, fileType: string, meta?: ArtMeta) => void
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
  const t = useT()
  const {
    textInput, textInputRef, handleTextInputChange, selectedObjectType, startNewText,
    dbFonts, fonts, selectedFont, setSelectedFont, selectedTextPreview,
    fontSize, setFontSize, letterSpacing, setLetterSpacing, lineHeight, setLineHeight, textColor, setTextColor,
    textDirection, setTextDirection, curveAmount, setCurveAmount, textIsMultiline,
    textAlign, handleTextAlign, isBold, setIsBold, isItalic, setIsItalic,
    isUppercase, setIsUppercase,
  } = text
  const { handleImageUpload, handleImageDrop, uploadGuidance, libraryUploads, libraryLoading, pickLibraryUpload, deleteLibraryUpload,
    removeWhite, removeBackground, eyedropperActive, setEyedropperActive, removeColorTol, setRemoveColorTol, imageEditBusy,
    colorPreview, applyColorRemoval, cancelColorRemoval, startCrop, cropMode, applyCrop, cancelCrop, lowResWarning } = upload
  const { printMethod, handleClipartSelect, recolorSvg, setSelectedSvgColor, selectedSvgColor } = clipart
  // A selected CURVED text is a baked image: only font/size/color/bold/italic
  // re-bake (they're the curve effect's deps). Letter-spacing, uppercase (AA),
  // Direction, and Align do NOT apply — so we disable them here instead of letting
  // them look active but do nothing. (Full support is deferred — straighten to edit.)
  const selectedIsCurved = selectedObjectType === 'text' && curveAmount !== 0
  // Selection-driven (Phase 2): the panel renders by SECTION (activeTab), and the
  // parent sets activeTab to the selected object's section on select — so the rail
  // highlight and this panel always agree on "what am I editing" (no panelMode
  // override needed; they read the same activeTab). Each section shows its ADD
  // surface always; the EDIT controls (reflected text knobs, recolor, delete)
  // activate when an object of that section is selected.
  return (
          <div className="px-4 pb-4 flex flex-col gap-4">

                        {/* TEXT — add (empty box) + edit (reflects the selected text) */}
            {activeTab === 'text' && (
              <>
                {/* The box is the typing surface — always live. The first
                    keystroke puts the text on the shirt; no button hunt. */}
                <div>
                  <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">{t('designer.text.your_text_label', 'Your Text')}</label>
                  <textarea value={textInput} ref={textInputRef} rows={3}
                    onChange={e => handleTextInputChange(e.target.value)}
                    placeholder={t('designer.text.placeholder', 'Type something...\nPress Enter for a new line')}
                    className="w-full mt-1 bg-gray-100 border border-gray-200 rounded px-3 py-2 text-sm text-gray-900 outline-none focus:border-[#dd3333] resize-y leading-snug"
                  />
                  {/* Teaches the quicker path, and only once it's useful. */}
                  {selectedObjectType === 'text' && (
                    <p className="mt-1.5 text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded px-2 py-1.5 leading-relaxed">
                      {t('designer.text.edit_hint_prefix', 'Or ')}<span className="font-semibold text-gray-700">{t('designer.text.edit_hint_action', 'double-click')}</span>{t('designer.text.edit_hint_suffix', ' the text on the shirt to edit it here.')}
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
                    {t('designer.text.add_another', '+ Add another text')}
                  </button>
                )}
                <div>
                  <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">{t('designer.text.font_label', 'Font')}</label>
                  <FontPicker
                    fonts={dbFonts.length > 0 ? dbFonts : fonts}
                    value={selectedFont}
                    onChange={setSelectedFont}
                    previewText={selectedTextPreview || textInput || t('designer.text.preview_placeholder', 'Preview Text')}
                  />
                </div>
                <div>
                  <div className="flex justify-between items-center">
                    <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">{t('designer.text.size_label', 'Size')}</label>
                    <input type="number" min={8} max={200} value={fontSize}
                      onChange={e => setFontSize(Number(e.target.value))}
                      className="w-14 bg-gray-100 border border-gray-200 rounded px-2 py-1 text-xs text-gray-900 outline-none text-center focus:border-[#dd3333]"
                    />
                  </div>
                  <input type="range" min={8} max={200} value={fontSize}
                    onChange={e => setFontSize(Number(e.target.value))}
                    className="w-full mt-1 accent-[#dd3333]" />
                </div>
                <div>
                  <div className="flex justify-between items-center">
                    <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">{t('designer.text.letter_spacing_label', 'Letter Spacing')}</label>
                    <span className="text-xs text-gray-700 font-mono">{letterSpacing}</span>
                  </div>
                  <input type="range" min={-5} max={30} value={letterSpacing}
                    onChange={e => setLetterSpacing(Number(e.target.value))}
                    className="w-full mt-1 accent-[#dd3333]" />
                </div>
                {/* Line Spacing — affects multi-line text only (a single line has no gaps), so it's
                    hidden on curved text (always single-line). 1.0 = tight, ~1.2 = default, 2.0 = airy. */}
                {!selectedIsCurved && (
                  <div>
                    <div className="flex justify-between items-center">
                      <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">{t('designer.text.line_spacing_label', 'Line Spacing')}</label>
                      <span className="text-xs text-gray-700 font-mono">{lineHeight.toFixed(2)}</span>
                    </div>
                    <input type="range" min={0.8} max={2.5} step={0.05} value={lineHeight}
                      onChange={e => setLineHeight(Number(e.target.value))}
                      className="w-full mt-1 accent-[#dd3333]" />
                  </div>
                )}
                <div>
                  <div className="flex justify-between items-center">
                    <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">{t('designer.text.curve_label', 'Curve')}</label>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-800 font-mono">{curveAmount > 0 ? `+${curveAmount}` : curveAmount}°</span>
                      <button onClick={() => setCurveAmount(0)} disabled={textIsMultiline}
                        className={`text-[10px] px-2 py-0.5 rounded font-mono transition-all ${
                          textIsMultiline ? 'bg-gray-100 text-gray-400 cursor-default'
                            : curveAmount !== 0 ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-800'
                        }`}>
                        {t('designer.text.straight', 'Straight')}
                      </button>
                    </div>
                  </div>
                  <input type="range" min="-360" max="360" value={curveAmount}
                    onChange={e => setCurveAmount(Number(e.target.value))}
                    disabled={textIsMultiline}
                    className="w-full mt-1 accent-[#dd3333] disabled:opacity-40" />
                  {textIsMultiline ? (
                    /* The arc renderer lays every character along ONE arc, so a
                       stacked design would silently collapse into a single line. */
                    <p className="text-[10px] text-gray-500 mt-1">{t('designer.text.curve_single_line', 'Curve works on single-line text.')}</p>
                  ) : (
                    <div className="flex justify-between text-[9px] text-gray-800 font-mono mt-0.5">
                      <span>{t('designer.text.curve_down', '⌣ Down')}</span>
                      <span>|</span>
                      <span>{t('designer.text.curve_up', '⌢ Up')}</span>
                    </div>
                  )}
                </div>
                {/* Format — style + alignment in one tidy toolbar (Illustrator-style glyphs from the
                    shared Lucide set). Bold/Italic re-bake on curved text; UPPERCASE + Align don't apply
                    to a baked curve, so they disable there. */}
                <div>
                  <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">{t('designer.text.format_label', 'Format')}</label>
                  <div className="grid grid-cols-3 gap-2 mt-1">
                    <button onClick={() => setIsBold(b => !b)} title={t('designer.text.bold_tooltip', 'Bold')}
                      className={`flex items-center justify-center py-2 rounded border transition-all ${isBold ? 'bg-gray-800 text-white border-gray-800' : 'bg-gray-100 text-gray-800 border-gray-200 hover:border-gray-400'}`}>
                      <Bold size={16} strokeWidth={2.5} />
                    </button>
                    <button onClick={() => setIsItalic(i => !i)} title={t('designer.text.italic_tooltip', 'Italic')}
                      className={`flex items-center justify-center py-2 rounded border transition-all ${isItalic ? 'bg-gray-800 text-white border-gray-800' : 'bg-gray-100 text-gray-800 border-gray-200 hover:border-gray-400'}`}>
                      <Italic size={16} strokeWidth={2.5} />
                    </button>
                    <button onClick={() => setIsUppercase(u => !u)} disabled={selectedIsCurved} title={t('designer.text.uppercase_tooltip', 'UPPERCASE')}
                      className={`flex items-center justify-center py-2 rounded border transition-all disabled:opacity-40 disabled:cursor-default ${isUppercase ? 'bg-gray-800 text-white border-gray-800' : 'bg-gray-100 text-gray-800 border-gray-200 hover:border-gray-400'}`}>
                      <CaseUpper size={18} strokeWidth={2.5} />
                    </button>
                  </div>
                  {/* Paragraph alignment (text-align glyphs — lines), incl. justify. Distinct from the
                      OBJECT-align cluster in the toolbar (which positions the whole object). */}
                  <div className="grid grid-cols-4 gap-2 mt-2">
                    {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight], ['justify', AlignJustify]] as const).map(([align, Icon]) => (
                      <button key={align} onClick={() => handleTextAlign(align)} disabled={selectedIsCurved} title={`${t('designer.text.align_tooltip_prefix', 'Align')} ${align}`}
                        className={`flex items-center justify-center py-2 rounded border transition-all disabled:opacity-40 disabled:cursor-default ${
                          textAlign === align ? 'bg-gray-800 text-white border-gray-800' : 'bg-gray-100 text-gray-800 border-gray-200 hover:border-gray-400'
                        }`}>
                        <Icon size={16} strokeWidth={2.5} />
                      </button>
                    ))}
                  </div>
                  {/* Case / direction / align don't apply to a curved text — it's a baked image. */}
                  {selectedIsCurved && (
                    <p className="text-[10px] text-gray-500 mt-2">{t('designer.text.curved_note', 'Curved text: straighten to change case, direction, or alignment.')}</p>
                  )}
                </div>
                <div>
                  <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">{t('designer.text.direction_label', 'Direction')}</label>
                  <div className="grid grid-cols-2 gap-2 mt-1">
                    <button onClick={() => setTextDirection('horizontal')} disabled={selectedIsCurved}
                      className={`flex items-center justify-center gap-1.5 py-2 rounded text-xs font-mono transition-all disabled:opacity-40 disabled:cursor-default border ${textDirection === 'horizontal' ? 'bg-gray-800 text-white border-gray-800' : 'bg-gray-100 text-gray-800 border-gray-200 hover:border-gray-400'}`}>
                      <MoveHorizontal size={14} /> {t('designer.text.direction_horizontal', 'Horizontal')}
                    </button>
                    <button onClick={() => setTextDirection('vertical')} disabled={selectedIsCurved}
                      className={`flex items-center justify-center gap-1.5 py-2 rounded text-xs font-mono transition-all disabled:opacity-40 disabled:cursor-default border ${textDirection === 'vertical' ? 'bg-gray-800 text-white border-gray-800' : 'bg-gray-100 text-gray-800 border-gray-200 hover:border-gray-400'}`}>
                      <MoveVertical size={14} /> {t('designer.text.direction_vertical', 'Vertical')}
                    </button>
                  </div>
                </div>
                {/* Text Color — LAST of the text controls (Denise: all text options sit ABOVE color). */}
                <div>
                  <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">{t('designer.text.color_label', 'Text Color')}</label>
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
                            ? 'ring-2 ring-gray-900 ring-offset-1 ring-offset-white'
                            : ''
                        }`}
                      />
                    ))}
                    {/* NO custom color picker — customers choose ONLY from the admin-set colors (Denise).
                        Same rule for Print and Embroidery. */}
                  </div>
                  {/* Chosen-color indicator: a larger SQUARE swatch of the CURRENT color + its name, so it
                      reads clearly different from the round pickable swatches. Same in both modes. */}
                  <div className="mt-2 flex items-center gap-2">
                    <span className="h-6 w-6 shrink-0 rounded-md border border-gray-300"
                      style={{ background: textColor }} aria-hidden="true" />
                    <span className="text-xs text-gray-800 font-mono">
                      {(dbColors.length > 0 ? dbColors : [{ label: 'White', hex: '#ffffff' }, { label: 'Black', hex: '#000000' }])
                        .find(c => c.hex?.toLowerCase() === textColor?.toLowerCase())?.label || textColor || t('designer.text.color_custom', 'Custom')}
                    </span>
                  </div>
                </div>
                {/* Delete belongs to EDIT, not the empty add-surface. */}
                {selectedObjectType === 'text' && (
                  <button onClick={deleteSelected}
                    className="w-full border border-red-800 text-red-400 py-2 rounded text-sm hover:bg-red-900/20 transition-colors">
                    {t('designer.delete_selected', 'Delete Selected')}
                  </button>
                )}
              </>
            )}
            {/* UPLOAD — dropzone + library always; Delete activates on a selected image */}
            {activeTab === 'upload' && (
              <div>
                <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">{t('designer.upload.artwork_label', 'Upload Artwork')}</label>
                <label
                  onDragOver={e => e.preventDefault()}
                  onDrop={handleImageDrop}
                  className="mt-2 flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-xl p-8 cursor-pointer hover:border-[#dd3333] hover:bg-[#dd3333]/5 transition-all">
                  <Upload size={28} className="mb-3 text-gray-500" strokeWidth={1.75} />
                  <span className="text-sm text-gray-800 text-center">
                    {t('designer.upload.drop_here', 'Drop image here')}<br />
                    <span className="text-xs opacity-60">{t('designer.upload.formats', 'JPG · PNG · SVG · AI · PSD · PDF')}</span>
                  </span>
                  <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp,application/pdf,.pdf,.svg,.png,.jpg,.jpeg,.webp,.ai,.psd" onChange={handleImageUpload} className="hidden" />
                </label>
                <p className="mt-1.5 text-[11px] text-gray-500 leading-snug">{uploadGuidance}</p>
                {/* A selected upload — image-editing tools (Phase 5) + Delete, ABOVE the uploads
                    strip (Denise #4). Remove White is one-tap; Remove a Color arms an eyedropper. */}
                {selectedObjectType === 'image' && (
                  <div className="mt-3 flex flex-col gap-2">
                    <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">{t('designer.upload.edit_image_label', 'Edit Image')}</label>
                    {lowResWarning && (
                      <p className="rounded border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-800">
                        {lowResWarning}
                      </p>
                    )}
                    {cropMode ? (
                      /* Manual crop — the drag-box lives on the shirt; commit here. */
                      <div className="border border-gray-300 rounded p-2 flex flex-col gap-2">
                        <p className="text-[11px] text-gray-600 leading-snug">{t('designer.upload.crop_instructions', 'Drag the box on the shirt to frame what to keep, then Apply.')}</p>
                        <div className="flex gap-2">
                          <button onClick={applyCrop} disabled={imageEditBusy}
                            className="flex-1 bg-[#dd3333] text-white py-2 rounded text-sm hover:bg-[#c02020] transition-colors disabled:opacity-50">{t('designer.upload.apply_crop', 'Apply Crop')}</button>
                          <button onClick={cancelCrop} disabled={imageEditBusy}
                            className="flex-1 border border-gray-300 text-gray-800 py-2 rounded text-sm hover:border-gray-500 transition-colors disabled:opacity-50">{t('designer.upload.cancel', 'Cancel')}</button>
                        </div>
                      </div>
                    ) : colorPreview ? (
                      /* Live color-removal preview — adjust tolerance, watch the shirt, commit with Apply. */
                      <div className="border border-gray-300 rounded p-2 flex flex-col gap-2">
                        <p className="text-[11px] text-gray-600 leading-snug">{t('designer.upload.color_removal_instructions', 'Adjust until only the color you want is gone, then Apply.')}</p>
                        <div>
                          <div className="flex justify-between items-center">
                            <label className="text-[11px] text-gray-600 font-mono">{t('designer.upload.color_match_label', 'Color match')}</label>
                            <span className="text-[11px] text-gray-600 font-mono">{removeColorTol}</span>
                          </div>
                          <input type="range" min={5} max={100} value={removeColorTol}
                            onChange={e => setRemoveColorTol(Number(e.target.value))}
                            className="w-full accent-[#dd3333]" />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={applyColorRemoval} disabled={imageEditBusy}
                            className="flex-1 bg-[#dd3333] text-white py-2 rounded text-sm hover:bg-[#c02020] transition-colors disabled:opacity-50">{t('designer.upload.apply', 'Apply')}</button>
                          <button onClick={cancelColorRemoval} disabled={imageEditBusy}
                            className="flex-1 border border-gray-300 text-gray-800 py-2 rounded text-sm hover:border-gray-500 transition-colors disabled:opacity-50">{t('designer.upload.cancel', 'Cancel')}</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <button onClick={removeBackground} disabled={imageEditBusy}
                          className="w-full border border-gray-300 text-gray-800 py-2 rounded text-sm hover:border-[#dd3333] hover:text-[#dd3333] transition-colors disabled:opacity-50">
                          {t('designer.upload.remove_background', 'Remove Background')}
                        </button>
                        <button onClick={removeWhite} disabled={imageEditBusy}
                          className="w-full border border-gray-300 text-gray-800 py-2 rounded text-sm hover:border-[#dd3333] hover:text-[#dd3333] transition-colors disabled:opacity-50">
                          {t('designer.upload.remove_white', 'Remove White')}
                        </button>
                        <button onClick={() => setEyedropperActive(v => !v)} disabled={imageEditBusy}
                          className={`w-full border py-2 rounded text-sm transition-colors disabled:opacity-50 ${
                            eyedropperActive ? 'border-gray-800 bg-gray-200 text-gray-900' : 'border-gray-300 text-gray-800 hover:border-[#dd3333] hover:text-[#dd3333]'
                          }`}>
                          {eyedropperActive ? t('designer.upload.eyedropper_active', 'Click the color on the shirt…') : t('designer.upload.remove_color', 'Remove a Color')}
                        </button>
                        <button onClick={startCrop} disabled={imageEditBusy}
                          className="w-full border border-gray-300 text-gray-800 py-2 rounded text-sm hover:border-[#dd3333] hover:text-[#dd3333] transition-colors disabled:opacity-50">
                          {t('designer.upload.crop', 'Crop…')}
                        </button>
                        <button onClick={deleteSelected}
                          className="w-full border border-red-800 text-red-400 py-2 rounded text-sm hover:bg-red-900/20 transition-colors">
                          {t('designer.delete_selected', 'Delete Selected')}
                        </button>
                      </>
                    )}
                    {imageEditBusy && <p className="text-[11px] text-gray-500">{t('designer.upload.processing', 'Processing…')}</p>}
                  </div>
                )}
                {/* Uploaded images — a horizontal scrolling strip, BELOW the edit tools (Denise #4). */}
                <div className="mt-3">
                  <MyUploadsPanel
                    uploads={libraryUploads}
                    loading={libraryLoading}
                    onPick={pickLibraryUpload}
                    onDelete={deleteLibraryUpload}
                  />
                </div>
              </div>
            )}

            {/* ART — the clipart browser stays visible always; selecting a
                clipart just activates its edit controls beside it (Denise's call,
                overriding the earlier hide-on-select). Color swatches show for an
                SVG (recolorable); Delete for any selected art object (SVG, or a
                raster clipart — which has no recolor). */}
            {activeTab === 'clipart' && (
              <div className="flex flex-col gap-3">
                <ClipartPanel
                  printMethod={printMethod}
                  onSelect={handleClipartSelect}
                />
                {/* SVG Color swatches — only SVGs can be recolored. */}
                {selectedObjectType === 'svg' && (
                  <div className="mt-2">
                    <label className="text-xs text-gray-800 uppercase tracking-widest font-mono">{t('designer.art.color_label', 'Clipart Color')}</label>
                    <div className="flex gap-2 mt-2 flex-wrap items-center">
                      {(dbColors.length > 0 ? dbColors : [
                        { label: 'Black', hex: '#000000' },
                        { label: 'White', hex: '#ffffff' },
                      ]).map(c => (
                        <button key={c.hex} onClick={() => { recolorSvg(c.hex); setSelectedSvgColor(c.hex) }}
                          title={c.label}
                          style={{ background: c.hex, border: c.hex === '#ffffff' ? '1px solid #555' : 'none' }}
                          className={`w-8 h-8 rounded-full transition-transform hover:scale-110 ${
                            selectedSvgColor === c.hex ? 'ring-2 ring-gray-900 ring-offset-2 ring-offset-white' : ''
                          }`}
                        />
                      ))}
                    </div>
                    {/* Chosen-color indicator — a larger SQUARE swatch + name, matching the Text Color
                        section so the two read the same. */}
                    <div className="mt-2 flex items-center gap-2">
                      <span className="h-6 w-6 shrink-0 rounded-md border border-gray-300"
                        style={{ background: selectedSvgColor }} aria-hidden="true" />
                      <span className="text-xs text-gray-800 font-mono">
                        {(dbColors.length > 0 ? dbColors : [{ label: 'Black', hex: '#000000' }, { label: 'White', hex: '#ffffff' }]).find(c => c.hex?.toLowerCase() === selectedSvgColor?.toLowerCase())?.label || selectedSvgColor || t('designer.art.color_default_name', 'Black')}
                      </span>
                    </div>
                  </div>
                )}
                {(selectedObjectType === 'svg' || selectedObjectType === 'image') && (
                  <button onClick={deleteSelected}
                    className="w-full border border-red-800 text-red-400 py-2 rounded text-sm hover:bg-red-900/20 transition-colors mt-2">
                    {t('designer.delete_selected', 'Delete Selected')}
                  </button>
                )}
              </div>
            )}

          </div>
  )
}
