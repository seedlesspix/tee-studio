'use client'
// Names & Numbers roster panel (the `names` rail tab). Presentational + controlled: the parent
// (DesignerCanvas) owns the roster array + the placeholder objects on the canvas. Light designer-
// panel palette; red = ACTION only (per the locked red-vocabulary rule).
import { useState } from 'react'
import { Plus, Trash2, Type, Hash, ClipboardPaste, Download, Eye, ChevronLeft, ChevronRight } from 'lucide-react'
import { type RosterEntry, emptyEntry, parseBulkRoster, rosterShirtCount } from '../lib/namesNumbers'

export default function NamesNumbersPanel({
  roster,
  onChange,
  onAddNameField,
  onAddNumberField,
  hasName,
  hasNumber,
  sizes = [],
  selectedRole = null,
  style,
  preview,
}: {
  roster: RosterEntry[]
  onChange: (roster: RosterEntry[]) => void
  onAddNameField: () => void
  onAddNumberField: () => void
  hasName: boolean
  hasNumber: boolean
  sizes?: string[]
  // When a placeholder is selected, style it HERE (limited, jersey-relevant controls) — placeholders
  // never enter the generic text-edit flow.
  selectedRole?: 'name' | 'number' | null
  style?: {
    fonts: { label: string; value: string }[]
    selectedFont: string
    setSelectedFont: (f: string) => void
    colors: { label: string; hex: string }[]
    textColor: string
    setTextColor: (c: string) => void
    fontSize: number
    setFontSize: (n: number) => void
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
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')

  const rows = roster.length ? roster : [emptyEntry(sizes[0] ?? '')]
  const update = (i: number, patch: Partial<RosterEntry>) =>
    onChange(rows.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  const addRow = () => onChange([...rows, emptyEntry(sizes[0] ?? '')])
  const removeRow = (i: number) => onChange(rows.filter((_, k) => k !== i).length ? rows.filter((_, k) => k !== i) : [emptyEntry(sizes[0] ?? '')])
  const applyPaste = () => {
    const parsed = parseBulkRoster(pasteText, sizes[0] ?? '')
    if (parsed.length) onChange(parsed)
    setPasteText(''); setPasteOpen(false)
  }

  const count = rosterShirtCount(rows)

  const fieldBtn = (active: boolean) =>
    `flex-1 flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
      active ? 'border-gray-800 bg-gray-100 text-gray-900' : 'border-dashed border-gray-300 text-gray-600 hover:border-gray-400 hover:text-gray-900'
    }`

  return (
    <div className="flex flex-col gap-3 p-3 text-gray-900">
      <div>
        <h3 className="text-sm font-semibold">Names &amp; Numbers</h3>
        <p className="mt-0.5 text-[11px] leading-snug text-gray-500">
          Name and Number are <span className="font-medium text-gray-700">placeholders</span> — style each one once
          (font, color, size). Every row in your list prints as its own shirt with that styling.
        </p>
      </div>

      {/* Selected-placeholder styling — limited, jersey-relevant controls, right here in the panel. */}
      {selectedRole && style && (
        <div className="flex flex-col gap-2 rounded-lg border border-gray-300 bg-gray-50 p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">Style the {selectedRole === 'name' ? 'Name' : 'Number'} field</span>
            <button type="button" onClick={style.onDeselect} className="text-[11px] text-gray-500 underline underline-offset-2 hover:text-gray-900">Done</button>
          </div>
          {/* Live style preview — the chosen font + color rendered, not just named. Thin ring keeps
              light inks (white) visible on the light card. */}
          <div className="flex h-14 items-center justify-center overflow-hidden rounded border border-gray-300 bg-white px-2">
            <span
              className="truncate leading-none"
              style={{ fontFamily: style.selectedFont, color: style.textColor, fontSize: 34, textShadow: '0 0 1px rgba(0,0,0,0.45)' }}
            >
              {selectedRole === 'name' ? 'NAME' : '00'}
            </span>
          </div>
          <div>
            <label className="text-[10px] font-mono uppercase tracking-wide text-gray-500">Font</label>
            <select value={style.selectedFont} onChange={e => style.setSelectedFont(e.target.value)}
              className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-xs outline-none focus:border-[#dd3333]">
              {style.fonts.map(f => <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>{f.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-mono uppercase tracking-wide text-gray-500">Color</label>
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
          <div>
            <label className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wide text-gray-500">
              <span>Size</span><span className="text-gray-700">{Math.round(style.fontSize)}</span>
            </label>
            <input type="range" min={12} max={200} value={style.fontSize} onChange={e => style.setFontSize(Number(e.target.value))} className="mt-1 w-full accent-[#dd3333]" />
          </div>
          <p className="text-[10px] leading-snug text-gray-400">Styles the placeholder — every {selectedRole} on your roster prints this way.</p>
        </div>
      )}

      {/* Placeholder fields on the shirt */}
      <div className="flex gap-2">
        <button type="button" onClick={onAddNameField} className={fieldBtn(hasName)}>
          <Type size={14} /> {hasName ? 'Name field ✓' : 'Add Name field'}
        </button>
        <button type="button" onClick={onAddNumberField} className={fieldBtn(hasNumber)}>
          <Hash size={14} /> {hasNumber ? 'Number field ✓' : 'Add Number field'}
        </button>
      </div>

      {/* Roster table */}
      <div className="rounded-lg border border-gray-200">
        <div className="grid grid-cols-[1fr_44px_52px_38px_24px] gap-1 border-b border-gray-200 bg-gray-50 px-2 py-1.5 text-[10px] font-mono uppercase tracking-wide text-gray-500">
          <span>Name</span><span>Number</span><span>Size</span><span>Qty</span><span />
        </div>
        <div className="max-h-[46vh] overflow-y-auto">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_44px_52px_38px_24px] items-center gap-1 border-b border-gray-100 px-2 py-1 last:border-b-0">
              <input value={r.name} onChange={e => update(i, { name: e.target.value })} placeholder="SMITH"
                className="w-full rounded border border-gray-200 px-1.5 py-1 text-xs outline-none focus:border-[#dd3333]" />
              <input value={r.number} onChange={e => update(i, { number: e.target.value })} placeholder="12"
                className="w-full rounded border border-gray-200 px-1.5 py-1 text-xs outline-none focus:border-[#dd3333]" />
              {sizes.length ? (
                <select value={r.size} onChange={e => update(i, { size: e.target.value })}
                  className="w-full rounded border border-gray-200 px-1 py-1 text-xs outline-none focus:border-[#dd3333]">
                  <option value=""></option>
                  {sizes.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              ) : (
                <input value={r.size} onChange={e => update(i, { size: e.target.value })} placeholder="L"
                  className="w-full rounded border border-gray-200 px-1.5 py-1 text-xs outline-none focus:border-[#dd3333]" />
              )}
              <input type="number" min={1} value={r.qty} onChange={e => update(i, { qty: Math.max(1, parseInt(e.target.value) || 1) })}
                className="w-full rounded border border-gray-200 px-1 py-1 text-xs outline-none focus:border-[#dd3333]" />
              <button type="button" onClick={() => removeRow(i)} title="Remove" className="flex justify-center text-gray-400 hover:text-[#dd3333]">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* PRIMARY = the row-by-row table above + Add row. Paste is a SECONDARY shortcut (small link). */}
      <div className="flex items-center gap-2">
        <button type="button" onClick={addRow} className="flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
          <Plus size={13} /> Add row
        </button>
        <span className="ml-auto text-xs font-medium text-gray-600">{count} shirt{count === 1 ? '' : 's'}</span>
      </div>

      {/* Live preview — cycle each roster entry onto the shirt so the customer sees the real thing
          (and that long names/3-digit numbers fit the box). Transient; never saved. */}
      {preview?.canPreview && (
        preview.index === null ? (
          <button type="button" onClick={preview.onStart}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50">
            <Eye size={14} /> Preview on shirt
          </button>
        ) : (() => {
          const e = preview.entries[preview.index]
          const label = e ? [e.name, e.number].filter(v => v && v.trim()).join(' · ') : ''
          return (
            <div className="flex items-center gap-1 rounded-lg border border-gray-800 bg-gray-100 px-1.5 py-1.5">
              <button type="button" onClick={() => preview.onStep(-1)} title="Previous"
                className="flex h-7 w-7 items-center justify-center rounded text-gray-600 hover:bg-white hover:text-gray-900"><ChevronLeft size={16} /></button>
              <div className="flex-1 text-center">
                <div className="truncate text-xs font-semibold text-gray-900">{label || '—'}</div>
                <div className="text-[10px] font-mono text-gray-500">{preview.index + 1} / {preview.entries.length}</div>
              </div>
              <button type="button" onClick={() => preview.onStep(1)} title="Next"
                className="flex h-7 w-7 items-center justify-center rounded text-gray-600 hover:bg-white hover:text-gray-900"><ChevronRight size={16} /></button>
              <button type="button" onClick={preview.onExit} title="Exit preview"
                className="ml-1 rounded px-2 py-1 text-[11px] font-medium text-gray-500 hover:text-gray-900">Done</button>
            </div>
          )
        })()
      )}

      <div className="flex items-center gap-3 text-[11px] text-gray-400">
        <span>Have a spreadsheet?</span>
        <button type="button" onClick={() => setPasteOpen(v => !v)} className="inline-flex items-center gap-1 text-gray-500 underline underline-offset-2 hover:text-gray-900">
          <ClipboardPaste size={11} /> Paste a list
        </button>
        <a href="/roster-template.xlsx" download className="inline-flex items-center gap-1 text-gray-500 underline underline-offset-2 hover:text-gray-900">
          <Download size={11} /> Template
        </a>
      </div>

      {pasteOpen && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-gray-200 bg-gray-50 p-2">
          {/* Format guidance right at the moment of need — for coaches who already have a roster. */}
          <p className="text-[11px] leading-snug text-gray-600">
            Paste straight from your spreadsheet — one shirt per line, e.g. <span className="font-mono text-gray-800">SMITH, 12, L, 2</span>
          </p>
          <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={4}
            placeholder={'SMITH, 12, L, 1\nJONES, 8, M, 1\nDE LA CRUZ, 24, XL, 2'}
            className="w-full rounded-lg border border-gray-300 bg-white p-2 font-mono text-xs outline-none focus:border-[#dd3333]" />
          <div className="flex gap-2">
            <button type="button" onClick={applyPaste} className="rounded-lg bg-[#dd3333] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#c62828]">Apply list</button>
            <button type="button" onClick={() => { setPasteOpen(false); setPasteText('') }} className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700">Cancel</button>
          </div>
          <p className="text-[10px] text-gray-400">Tab or comma separated (a spreadsheet copy works). Replaces the current list.</p>
        </div>
      )}
    </div>
  )
}
