'use client'
// Names & Numbers roster panel (the `names` rail tab). Presentational + controlled: the parent
// (DesignerCanvas) owns the roster array + the placeholder objects on the canvas. Light designer-
// panel palette; red = ACTION only (per the locked red-vocabulary rule).
import { type KeyboardEvent as ReactKeyboardEvent, useState } from 'react'
import { Plus, Trash2, Type, Hash, Tag, ClipboardPaste, Download, Eye, ChevronLeft, ChevronRight } from 'lucide-react'
import { type RosterEntry, emptyEntry, parseBulkRoster, rosterShirtCount } from '../lib/namesNumbers'
import FontPicker from './FontPicker'
import { useT } from './StringsProvider'

export default function NamesNumbersPanel({
  roster,
  onChange,
  onAddNameField,
  onAddNumberField,
  onAddTitleField,
  printReady = true,
  hasName,
  hasNumber,
  hasTitle,
  sizes = [],
  selectedRole = null,
  style,
  preview,
}: {
  roster: RosterEntry[]
  onChange: (roster: RosterEntry[]) => void
  onAddNameField: () => void
  onAddNumberField: () => void
  onAddTitleField: () => void
  // False when this product/side has no loaded print area — the fields have nowhere to land, so the
  // Add buttons are disabled with an explanation instead of silently doing nothing.
  printReady?: boolean
  hasName: boolean
  hasNumber: boolean
  hasTitle: boolean
  sizes?: string[]
  // When a placeholder is selected, style it HERE (limited, jersey-relevant controls) — placeholders
  // never enter the generic text-edit flow.
  selectedRole?: 'name' | 'number' | 'title' | null
  style?: {
    fonts: { label: string; value: string; category?: string | null }[]
    selectedFont: string
    setSelectedFont: (f: string) => void
    colors: { label: string; hex: string }[]
    textColor: string
    setTextColor: (c: string) => void
    onDeselect: () => void
  }
  // Cycle the roster onto the shirt so the customer sees a real personalized preview. index===null
  // means not previewing. The parent owns the canvas substitution/restore.
  preview?: {
    canPreview: boolean
    entries: RosterEntry[]
    index: number | null
    onStart: () => void
    onStep: (delta: number) => void
    onExit: () => void
  }
}) {
  const t = useT()
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')

  const rows = roster.length ? roster : [emptyEntry(sizes[0] ?? '')]
  const update = (i: number, patch: Partial<RosterEntry>) =>
    onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  const addRow = () => onChange([...rows, emptyEntry(sizes[0] ?? '')])
  const removeRow = (i: number) => onChange(rows.filter((_, k) => k !== i).length ? rows.filter((_, k) => k !== i) : [emptyEntry(sizes[0] ?? '')])
  // Native feel (Denise round 2): Enter in a roster field adds another row.
  const onRowKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); addRow() }
  }
  const applyPaste = () => {
    const parsed = parseBulkRoster(pasteText, sizes[0] ?? '')
    if (parsed.length) onChange(parsed)
    setPasteText(''); setPasteOpen(false)
  }

  const count = rosterShirtCount(rows)

  // Roster columns MIRROR the placed fields: a column shows only for a field actually on the shirt
  // (Size + Qty always). Before any field is placed, default to Name + Number so the table is usable.
  // Name/Title uppercase as you type — the entry half of the belt-and-suspenders uppercase rule.
  const anyPlaced = hasName || hasNumber || hasTitle
  const cols = { name: hasName || !anyPlaced, number: hasNumber || !anyPlaced, title: hasTitle }
  // Name + Title carry WORDS and get the flexible room; Number/Size/Qty are 2–3 chars (Size is a
  // dropdown) so they're pinned narrow — otherwise four boxes crush the name fields (Denise).
  const gridTemplate = [
    cols.name ? 'minmax(0,1.2fr)' : null,
    cols.number ? '34px' : null,
    cols.title ? 'minmax(0,1fr)' : null,
    '48px', // size (dropdown)
    '30px', // qty
    '20px', // remove
  ].filter(Boolean).join(' ')

  const fieldBtn = (active: boolean) =>
    `flex-1 flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
      active ? 'border-gray-800 bg-gray-100 text-gray-900' : 'border-dashed border-gray-300 text-gray-600 hover:border-gray-400 hover:text-gray-900'
    }`

  return (
    <div className="flex flex-col gap-3 p-3 text-gray-900">
      <div>
        <h3 className="text-sm font-semibold">{t('nn.heading', 'Names & Numbers')}</h3>
        <p className="mt-0.5 text-[11px] leading-snug text-gray-500">
          {t('nn.intro_a', 'Name, Number, and Title are')}{' '}
          <span className="font-medium text-gray-700">{t('nn.intro_placeholders', 'placeholders')}</span>{' '}
          {t('nn.intro_b', '— style each once (font, color, size). Every row in your list prints as its own shirt. Text prints UPPERCASE.')}
        </p>
      </div>

      {/* Placeholder fields — the classic jersey stack: Name (top) · Title (below name) · Number (center) */}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onAddNameField} disabled={!printReady} className={fieldBtn(hasName)}>
          <Type size={14} /> {hasName ? t('nn.name_done', 'Name ✓') : t('nn.add_name', 'Add Name')}
        </button>
        <button type="button" onClick={onAddNumberField} disabled={!printReady} className={fieldBtn(hasNumber)}>
          <Hash size={14} /> {hasNumber ? t('nn.number_done', 'Number ✓') : t('nn.add_number', 'Add Number')}
        </button>
        <button type="button" onClick={onAddTitleField} disabled={!printReady} className={fieldBtn(hasTitle)}>
          <Tag size={14} /> {hasTitle ? t('nn.title_done', 'Title ✓') : t('nn.add_title', 'Add Title')}
        </button>
      </div>
      {!printReady && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] leading-snug text-amber-800">
          {t('nn.no_print_area_a', "This product doesn't have a print area loaded yet, so there's nowhere to place the name/number. Add a print area for it in")}{' '}
          <span className="font-medium">{t('nn.no_print_area_templates', 'Templates')}</span>{' '}
          {t('nn.no_print_area_b', '(admin), then reload the designer.')}
        </p>
      )}

      {/* Roster table — columns mirror the placed fields (Name/Number/Title), Size + Qty always. */}
      <div className="rounded-lg border border-gray-200">
        <div className="grid gap-1 border-b border-gray-200 bg-gray-50 px-2 py-1.5 text-[10px] font-mono uppercase tracking-wide text-gray-500" style={{ gridTemplateColumns: gridTemplate }}>
          {cols.name && <span>{t('nn.col_name', 'Name')}</span>}
          {cols.number && <span>{t('nn.col_number', 'Number')}</span>}
          {cols.title && <span>{t('nn.col_title', 'Title')}</span>}
          <span>{t('nn.col_size', 'Size')}</span><span>{t('nn.col_qty', 'Qty')}</span><span />
        </div>
        <div className="max-h-[46vh] overflow-y-auto">
          {rows.map((r, i) => (
            <div key={i} className="grid items-center gap-1 border-b border-gray-100 px-2 py-1 last:border-b-0" style={{ gridTemplateColumns: gridTemplate }}>
              {cols.name && (
                <input value={r.name} onChange={e => update(i, { name: e.target.value.toUpperCase() })} onKeyDown={onRowKeyDown} placeholder={t('nn.ph_name', 'SMITH')}
                  className="w-full rounded border border-gray-200 px-1.5 py-1 text-xs uppercase outline-none focus:border-[#dd3333]" />
              )}
              {cols.number && (
                <input value={r.number} onChange={e => update(i, { number: e.target.value })} onKeyDown={onRowKeyDown} placeholder={t('nn.ph_number', '12')}
                  className="w-full rounded border border-gray-200 px-1.5 py-1 text-xs outline-none focus:border-[#dd3333]" />
              )}
              {cols.title && (
                <input value={r.title} onChange={e => update(i, { title: e.target.value.toUpperCase() })} onKeyDown={onRowKeyDown} placeholder={t('nn.ph_title', 'CAPTAIN')}
                  className="w-full rounded border border-gray-200 px-1.5 py-1 text-xs uppercase outline-none focus:border-[#dd3333]" />
              )}
              {sizes.length ? (
                <select value={r.size} onChange={e => update(i, { size: e.target.value })}
                  className="w-full rounded border border-gray-200 px-1 py-1 text-xs outline-none focus:border-[#dd3333]">
                  <option value=""></option>
                  {sizes.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <input value={r.size} onChange={e => update(i, { size: e.target.value })} placeholder={t('nn.ph_size', 'L')}
                  className="w-full rounded border border-gray-200 px-1.5 py-1 text-xs outline-none focus:border-[#dd3333]" />
              )}
              <input type="number" min={1} value={r.qty} onChange={e => update(i, { qty: Math.max(1, parseInt(e.target.value) || 1) })} onKeyDown={onRowKeyDown}
                className="w-full rounded border border-gray-200 px-1 py-1 text-xs outline-none focus:border-[#dd3333]" />
              <button type="button" onClick={() => removeRow(i)} title={t('nn.row_remove', 'Remove')} className="flex justify-center text-gray-400 hover:text-[#dd3333]">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* PRIMARY = the row-by-row table above + Add row. Paste is a SECONDARY shortcut (small link). */}
      <div className="flex items-center gap-2">
        <button type="button" onClick={addRow} className="flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
          <Plus size={13} /> {t('nn.add_row', 'Add row')}
        </button>
        <span className="ml-auto text-xs font-medium text-gray-600">{count} {count === 1 ? t('nn.shirt_one', 'shirt') : t('nn.shirt_many', 'shirts')}</span>
      </div>

      {/* Live preview — cycle each roster entry onto the shirt so the customer sees the real thing
          (and that long names/3-digit numbers fit the box). Transient; never saved. */}
      {preview?.canPreview && (
        preview.index === null ? (
          <button type="button" onClick={preview.onStart}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50">
            <Eye size={14} /> {t('nn.preview_start', 'Preview on shirt')}
          </button>
        ) : (() => {
          const e = preview.entries[preview.index]
          const label = e ? [e.name, e.number].filter(v => v && v.trim()).join(' · ') : ''
          return (
            <div className="flex items-center gap-1 rounded-lg border border-gray-800 bg-gray-100 px-1.5 py-1.5">
              <button type="button" onClick={() => preview.onStep(-1)} title={t('nn.preview_prev', 'Previous')}
                className="flex h-7 w-7 items-center justify-center rounded text-gray-600 hover:bg-white hover:text-gray-900"><ChevronLeft size={16} /></button>
              <div className="flex-1 text-center">
                <div className="truncate text-xs font-semibold text-gray-900">{label || '—'}</div>
                <div className="text-[10px] font-mono text-gray-500">{preview.index + 1} / {preview.entries.length}</div>
              </div>
              <button type="button" onClick={() => preview.onStep(1)} title={t('nn.preview_next', 'Next')}
                className="flex h-7 w-7 items-center justify-center rounded text-gray-600 hover:bg-white hover:text-gray-900"><ChevronRight size={16} /></button>
              <button type="button" onClick={preview.onExit} title={t('nn.preview_exit', 'Exit preview')}
                className="ml-1 rounded px-2 py-1 text-[11px] font-medium text-gray-500 hover:text-gray-900">{t('nn.preview_done', 'Done')}</button>
            </div>
          )
        })()
      )}

      {/* Selected-placeholder styling — BELOW the fields/roster (Denise: the list stays on top). The
          font name is shown persistently so a coach can eyeball that Name and Number match (letters
          and numbers render differently even in the same font). */}
      {selectedRole && style && (() => {
        const fontLabel = style.fonts.find(f => f.value === style.selectedFont)?.label ?? style.selectedFont
        const roleLabel = selectedRole === 'name' ? t('nn.role_name', 'Name') : selectedRole === 'title' ? t('nn.role_title', 'Title') : t('nn.role_number', 'Number')
        const roleSample = selectedRole === 'name' ? t('nn.sample_name', 'NAME') : selectedRole === 'title' ? t('nn.sample_title', 'TITLE') : t('nn.sample_number', '00')
        return (
          <div className="flex flex-col gap-2 rounded-lg border border-gray-300 bg-gray-50 p-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">
                {t('nn.style_the', 'Style the')} {roleLabel} {t('nn.style_field', 'field')} <span className="font-normal text-gray-500">— {fontLabel}</span>
              </span>
              <button type="button" onClick={style.onDeselect} className="text-[11px] text-gray-500 underline underline-offset-2 hover:text-gray-900">{t('nn.style_done', 'Done')}</button>
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase tracking-wide text-gray-500">{t('nn.font_label', 'Font')}</label>
              {/* Same picker the Text panel uses — each font renders its own name, previewing the
                  placeholder's sample ("NAME"/"00"). */}
              <FontPicker
                fonts={style.fonts}
                value={style.selectedFont}
                onChange={style.setSelectedFont}
                previewText={roleSample}
                maxHeightClass="max-h-40"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase tracking-wide text-gray-500">{t('nn.color_label', 'Color')} <span className="normal-case text-gray-400">{t('nn.color_hint', '— one ink, all fields')}</span></label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {style.colors.map(c => {
                  const active = style.textColor.toLowerCase() === c.hex.toLowerCase()
                  return (
                    <button key={c.hex} type="button" title={c.label} onClick={() => style.setTextColor(c.hex)}
                      className={`h-6 w-6 rounded-full ${active ? 'ring-2 ring-gray-900 ring-offset-1' : 'ring-1 ring-gray-300'}`}
                      style={{ background: c.hex }} />
                  )
                })}
              </div>
            </div>
            <p className="text-[10px] leading-snug text-gray-400">
              {t('nn.style_note_a', 'Font & color only — position and size are set automatically to the jersey layout (long names shrink to fit). Every')}{' '}{selectedRole}{' '}{t('nn.style_note_b', 'on your roster prints this way.')}
            </p>
          </div>
        )
      })()}

      <div className="flex items-center gap-3 text-[11px] text-gray-400">
        <span>{t('nn.paste_prompt', 'Have a spreadsheet?')}</span>
        <button type="button" onClick={() => setPasteOpen(v => !v)} className="inline-flex items-center gap-1 text-gray-500 underline underline-offset-2 hover:text-gray-900">
          <ClipboardPaste size={11} /> {t('nn.paste_link', 'Paste a list')}
        </button>
        <a href="/roster-template.xlsx" download className="inline-flex items-center gap-1 text-gray-500 underline underline-offset-2 hover:text-gray-900">
          <Download size={11} /> {t('nn.template_link', 'Template')}
        </a>
      </div>

      {pasteOpen && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-gray-200 bg-gray-50 p-2">
          {/* Format guidance right at the moment of need — for coaches who already have a roster. */}
          <p className="text-[11px] leading-snug text-gray-600">
            {t('nn.paste_format_a', 'One shirt per line:')} <span className="font-mono text-gray-800">{t('nn.paste_format_cols', 'Name, Number, Size, Qty, Title')}</span> {t('nn.paste_format_b', '— Title is optional, e.g.')} <span className="font-mono text-gray-800">{t('nn.paste_format_example', 'SMITH, 12, L, 1, CAPTAIN')}</span>
          </p>
          <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={4}
            placeholder={t('nn.paste_placeholder', 'SMITH, 12, L, 1, CAPTAIN\nJONES, 8, M, 1\nDE LA CRUZ, 24, XL, 2')}
            className="w-full rounded-lg border border-gray-300 bg-white p-2 font-mono text-xs outline-none focus:border-[#dd3333]" />
          <div className="flex gap-2">
            <button type="button" onClick={applyPaste} className="rounded-lg bg-[#dd3333] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#c62828]">{t('nn.paste_apply', 'Apply list')}</button>
            <button type="button" onClick={() => { setPasteOpen(false); setPasteText('') }} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700">{t('nn.paste_cancel', 'Cancel')}</button>
          </div>
          <p className="text-[10px] text-gray-400">{t('nn.paste_note', 'Tab or comma separated (a spreadsheet copy works). Replaces the current list.')}</p>
        </div>
      )}
    </div>
  )
}
