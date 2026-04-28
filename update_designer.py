import re

with open('/Users/deniseplumb/Desktop/tee-studio/app/components/DesignerCanvas.tsx', 'r') as f:
    content = f.read()

# ── 1. Replace font select dropdown with visual font picker ──────────────────
old1 = """                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-widest font-mono">Font</label>
                  <select value={selectedFont} onChange={e => setSelectedFont(e.target.value)}
                    className="w-full mt-1 bg-[#1e1e1e] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white outline-none">
                    {fonts.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </div>"""

new1 = """                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-widest font-mono">Font</label>
                  <div className="flex flex-col gap-1 mt-1 max-h-48 overflow-y-auto pr-1">
                    {(dbFonts.length > 0 ? dbFonts : fonts).map(f => (
                      <button key={f.value} onClick={() => setSelectedFont(f.value)}
                        className={`w-full text-left px-3 py-2 rounded border transition-all ${
                          selectedFont === f.value
                            ? 'border-[#e8ff47] bg-[#e8ff47]/10'
                            : 'border-[#2a2a2a] bg-[#1e1e1e] hover:border-[#444]'
                        }`}>
                        <div className="text-xs text-gray-500 font-mono mb-0.5">{f.label}</div>
                        <div style={{ fontFamily: f.value, fontSize: '18px', color: '#fff', lineHeight: 1.2 }}>
                          {textInput || 'Preview Text'}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>"""

if old1 in content:
    content = content.replace(old1, new1)
    print('SUCCESS - visual font picker added')
else:
    print('NOT FOUND - font select')
    idx = content.find('Font</label>')
    if idx > 0:
        print(repr(content[idx:idx+300]))

# ── 2. Replace hardcoded color swatches with DB colors ───────────────────────
old2 = """                  <div className="flex gap-2 mt-2 flex-wrap items-center">
                    {['#ffffff','#111111','#e63946','#457b9d','#f4a261','#2a9d8f','#e8ff47','#ff6b35','#a855f7'].map(c => (
                      <button key={c} onClick={() => setTextColor(c)}
                        style={{ background: c, border: c === '#ffffff' ? '1px solid #555' : 'none' }}
                        className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${textColor === c ? 'border-[#e8ff47]' : 'border-transparent'}`}
                      />
                    ))}
                    <input type="color" value={textColor}
                      onChange={e => setTextColor(e.target.value)}
                      className="w-7 h-7 rounded-full cursor-pointer overflow-hidden" />
                  </div>"""

new2 = """                  <div className="flex gap-2 mt-2 flex-wrap items-center">
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
                            ? 'ring-2 ring-[#e8ff47] ring-offset-1 ring-offset-[#161616]'
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
                    <p className="text-xs text-gray-500 mt-1 font-mono">
                      {dbColors.find(c => c.hex === textColor)?.label || 'Custom'}
                    </p>
                  )}"""

if old2 in content:
    content = content.replace(old2, new2)
    print('SUCCESS - DB colors added')
else:
    print('NOT FOUND - color swatches')
    idx = content.find('#e63946')
    if idx > 0:
        print(repr(content[idx-100:idx+100]))

with open('/Users/deniseplumb/Desktop/tee-studio/app/components/DesignerCanvas.tsx', 'w') as f:
    f.write(content)

print('Done!')
