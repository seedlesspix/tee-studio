'use client'
// Shared font picker: a scrollable list where each row renders its OWN name in that font, so you
// preview before choosing (a real font menu, not a native <select> that ignores per-option fonts).
// Used by BOTH the Text panel and the Names & Numbers styling section — one component so the two
// can't drift. `previewText` is what each row renders: the customer's typed text in the Text panel,
// the placeholder sample ("NAME"/"00") in N&N. Extracted verbatim from the Text panel's list.
export default function FontPicker({
  fonts,
  value,
  onChange,
  previewText,
  maxHeightClass = 'max-h-48',
}: {
  fonts: { label: string; value: string }[]
  value: string
  onChange: (value: string) => void
  previewText: string
  maxHeightClass?: string
}) {
  return (
    <div className={`flex flex-col gap-1 mt-1 ${maxHeightClass} overflow-y-auto pr-1`}>
      {fonts.map(f => (
        <button key={f.value} type="button" onClick={() => onChange(f.value)}
          className={`w-full text-left px-3 py-2 rounded border transition-all ${
            value === f.value
              ? 'border-gray-800 bg-white'
              : 'border-gray-200 bg-gray-100 hover:border-[#444]'
          }`}>
          <div className="text-xs text-gray-800 font-mono mb-0.5">{f.label}</div>
          <div style={{ fontFamily: f.value, fontSize: '18px', color: '#161616', lineHeight: 1.2 }}>
            {previewText || f.label}
          </div>
        </button>
      ))}
    </div>
  )
}
