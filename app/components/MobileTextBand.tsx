'use client'
import { useState } from 'react'
import { AlignLeft, AlignCenter, AlignRight, AlignJustify, MoveHorizontal, MoveVertical } from 'lucide-react'
import MobileAlignRow from './MobileAlignRow'
import { useT } from './StringsProvider'

// MobileTextBand — BLOCKER-2 mobile rework, Stage 2. The Text tool's controls laid
// out for the compact bottom band, ImprintNext-style: a sub-tool row
// (Type / Font / Size / Color / Style) with ONE compact control group visible at a
// time, so the fixed band never needs a tall vertical scroll. The hero is Font: an
// "All" category chip (single until admin gets a category field) + a search box +
// ONE horizontally-scrolling row of live font previews.
//
// MOBILE-ONLY: rendered only inside MobileToolBand (isMobile). Desktop keeps the
// vertical SelectionPanel untouched, so this file carries zero desktop risk. It
// drives the exact same parent setters the desktop panel does (PUSH model), so a
// change here writes onto the active Fabric object identically.
type SubTool = 'type' | 'font' | 'size' | 'color' | 'style'

const SUBS: { key: SubTool; label: string }[] = [
  { key: 'type', label: 'Type' },
  { key: 'font', label: 'Font' },
  { key: 'size', label: 'Size' },
  { key: 'color', label: 'Color' },
  { key: 'style', label: 'Style' },
]

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function MobileTextBand({
  text,
  dbColors,
  deleteSelected,
  alignObject,
}: {
  text: any
  dbColors: any[]
  deleteSelected: () => void
  alignObject: (fn: string) => void
}) {
  const t = useT()
  const {
    textInput, textInputRef, handleTextInputChange, selectedObjectType, startNewText,
    dbFonts, fonts, selectedFont, setSelectedFont, selectedTextPreview,
    fontSize, setFontSize, textColor, setTextColor, textDirection, setTextDirection,
    curveAmount, setCurveAmount, textIsMultiline, textAlign, handleTextAlign,
    isBold, setIsBold, isItalic, setIsItalic, isUppercase, setIsUppercase,
  } = text

  const [sub, setSub] = useState<SubTool>('type')
  const [fontQuery, setFontQuery] = useState('')

  const selectedIsCurved = selectedObjectType === 'text' && curveAmount !== 0
  const allFonts = (dbFonts.length > 0 ? dbFonts : fonts) as { label: string; value: string }[]
  const fontList = fontQuery
    ? allFonts.filter(f => f.label.toLowerCase().includes(fontQuery.toLowerCase()))
    : allFonts
  const sample = (selectedTextPreview || textInput || t('designer.text.font_sample', 'Abc')).slice(0, 10) || t('designer.text.font_sample', 'Abc')
  const colorList = (dbColors.length > 0 ? dbColors : [
    { label: 'White', hex: '#ffffff' }, { label: 'Black', hex: '#000000' },
  ]) as { label: string; hex: string }[]

  const chip = (active: boolean) =>
    `shrink-0 px-3 py-1 rounded-full text-xs font-mono border transition-colors ${
      active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-300'
    }`

  return (
    <div className="flex h-full flex-col">
      {/* Sub-tool row (hidden in keyboard mode so only the textarea shows) */}
      <div className="flex shrink-0 gap-1.5 overflow-x-auto px-3 pt-2 pb-1.5">
        {SUBS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setSub(key)}
            className={chip(sub === key)}
          >
            {t(`designer.text.sub_${key}`, label)}
          </button>
        ))}
      </div>

      {/* One control group at a time — fills the rest of the fixed band */}
      <div className="min-h-0 flex-1 px-3 pb-2">
        {sub === 'type' && (
          <div className="flex h-full flex-col gap-1.5">
            <textarea
              value={textInput}
              ref={textInputRef}
              onChange={e => handleTextInputChange(e.target.value)}
              placeholder={t('designer.text.type_placeholder', 'Type something…  ↵ for a new line')}
              className="min-h-0 flex-1 w-full resize-none rounded border border-gray-200 bg-gray-100 px-3 py-2 text-base leading-snug text-gray-900 outline-none focus:border-[#dd3333]"
            />
            {selectedObjectType === 'text' && (
              <button
                onClick={startNewText}
                className="shrink-0 rounded border border-gray-300 py-1.5 text-xs text-gray-700 transition-colors hover:border-[#dd3333] hover:text-[#dd3333]"
              >
                {t('designer.text.add_another', '+ Add another text')}
              </button>
            )}
          </div>
        )}

        {sub === 'font' && (
          <div className="flex h-full flex-col gap-2">
            {/* Category chips (single "All" until admin gets a category field) + search */}
            <div className="flex shrink-0 items-center gap-2">
              <span className={chip(true)}>{t('designer.text.category_all', 'All')}</span>
              <input
                value={fontQuery}
                onChange={e => setFontQuery(e.target.value)}
                placeholder={t('designer.text.search_fonts', 'Search fonts')}
                className="min-w-0 flex-1 rounded-full border border-gray-300 bg-white px-3 py-1 text-sm text-gray-900 outline-none focus:border-gray-500"
              />
            </div>
            {/* ONE horizontal row of live font previews */}
            <div className="flex min-h-0 flex-1 items-stretch gap-2 overflow-x-auto pb-1">
              {fontList.map(f => (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setSelectedFont(f.value)}
                  className={`flex w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border px-2 py-1.5 transition-colors ${
                    selectedFont === f.value ? 'border-gray-900 bg-white' : 'border-gray-200 bg-gray-50'
                  }`}
                >
                  <span
                    style={{ fontFamily: f.value, fontSize: 22, lineHeight: 1.1, color: '#161616' }}
                    className="max-w-full truncate"
                  >
                    {sample}
                  </span>
                  <span className="max-w-full truncate font-mono text-[9px] text-gray-500">{f.label}</span>
                </button>
              ))}
              {fontList.length === 0 && (
                <span className="self-center px-2 text-xs text-gray-400">{t('designer.text.no_fonts_match', 'No fonts match')} “{fontQuery}”.</span>
              )}
            </div>
          </div>
        )}

        {sub === 'size' && (
          <div className="flex h-full flex-col justify-center gap-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs uppercase tracking-widest text-gray-700">{t('designer.text.size_label', 'Size')}</span>
              <input
                type="number" min={8} max={120} value={fontSize}
                onChange={e => setFontSize(Number(e.target.value))}
                className="w-16 rounded border border-gray-200 bg-gray-100 px-2 py-1 text-center text-sm text-gray-900 outline-none focus:border-[#dd3333]"
              />
            </div>
            <input
              type="range" min={8} max={120} value={fontSize}
              onChange={e => setFontSize(Number(e.target.value))}
              className="w-full accent-[#dd3333]"
            />
          </div>
        )}

        {sub === 'color' && (
          <div className="flex h-full flex-col justify-center gap-2">
            <span className="font-mono text-xs uppercase tracking-widest text-gray-700">{t('designer.text.color_label', 'Text Color')}</span>
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {colorList.map(c => (
                <button
                  key={c.hex}
                  type="button"
                  onClick={() => setTextColor(c.hex)}
                  title={c.label}
                  style={{ background: c.hex, border: c.hex === '#ffffff' ? '1px solid #999' : 'none' }}
                  className={`h-9 w-9 shrink-0 rounded-full transition-transform ${
                    textColor === c.hex ? 'ring-2 ring-gray-900 ring-offset-2 ring-offset-white' : ''
                  }`}
                />
              ))}
              <input
                type="color" value={textColor}
                onChange={e => setTextColor(e.target.value)}
                title={t('designer.text.custom_color', 'Custom color')}
                className="h-9 w-9 shrink-0 cursor-pointer overflow-hidden rounded-full"
              />
            </div>
          </div>
        )}

        {sub === 'style' && (
          <div className="flex h-full flex-col justify-center gap-2 overflow-y-auto">
            {/* Position the text on the shirt (same compact icons as Art) + Delete */}
            <MobileAlignRow alignObject={alignObject} onDelete={deleteSelected} />
            {/* Text justify (within the box) + effects */}
            <div className="flex items-center gap-1.5">
              {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight], ['justify', AlignJustify]] as const).map(([a, Icon]) => (
                <button
                  key={a}
                  onClick={() => handleTextAlign(a)}
                  disabled={selectedIsCurved}
                  title={`${t('designer.text.align_prefix', 'Align')} ${a}`}
                  className={`flex flex-1 items-center justify-center rounded py-1.5 transition-all disabled:opacity-40 ${
                    textAlign === a ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 border border-gray-200'
                  }`}
                >
                  <Icon size={15} strokeWidth={2.5} />
                </button>
              ))}
              <button
                onClick={() => setIsBold((b: boolean) => !b)}
                className={`flex-1 rounded py-1.5 text-xs font-bold transition-all ${isBold ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 border border-gray-200'}`}
              >{t('designer.text.bold', 'B')}</button>
              <button
                onClick={() => setIsItalic((i: boolean) => !i)}
                className={`flex-1 rounded py-1.5 text-xs italic transition-all ${isItalic ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 border border-gray-200'}`}
              >{t('designer.text.italic', 'I')}</button>
              <button
                onClick={() => setIsUppercase((u: boolean) => !u)}
                disabled={selectedIsCurved}
                className={`flex-1 rounded py-1.5 text-xs font-mono transition-all disabled:opacity-40 ${isUppercase ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 border border-gray-200'}`}
              >{t('designer.text.uppercase', 'AA')}</button>
            </div>
            {/* Curve + direction */}
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs uppercase tracking-widest text-gray-700">{t('designer.text.curve_label', 'Curve')}</span>
              <input
                type="range" min={-360} max={360} value={curveAmount}
                onChange={e => setCurveAmount(Number(e.target.value))}
                disabled={textIsMultiline}
                className="min-w-0 flex-1 accent-[#dd3333] disabled:opacity-40"
              />
              <button
                onClick={() => setCurveAmount(0)}
                disabled={textIsMultiline}
                className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-mono ${textIsMultiline ? 'bg-gray-100 text-gray-400' : curveAmount !== 0 ? 'bg-gray-900 text-white' : 'bg-gray-200 text-gray-700'}`}
              >
                {t('designer.text.straight', 'Straight')}
              </button>
            </div>
            {textIsMultiline && (
              <p className="text-[10px] text-gray-500">{t('designer.text.curve_singleline', 'Curve works on single-line text.')}</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setTextDirection('horizontal')}
                disabled={selectedIsCurved}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded py-1.5 text-xs font-mono transition-all disabled:opacity-40 ${textDirection === 'horizontal' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 border border-gray-200'}`}
              ><MoveHorizontal size={14} /> {t('designer.text.direction_horizontal', 'Horizontal')}</button>
              <button
                onClick={() => setTextDirection('vertical')}
                disabled={selectedIsCurved}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded py-1.5 text-xs font-mono transition-all disabled:opacity-40 ${textDirection === 'vertical' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 border border-gray-200'}`}
              ><MoveVertical size={14} /> {t('designer.text.direction_vertical', 'Vertical')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
