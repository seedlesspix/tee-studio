import re

with open('/Users/deniseplumb/Desktop/tee-studio/app/components/DesignerCanvas.tsx', 'r') as f:
    content = f.read()

# ── 1. Add new state variables after fontSize ──────────────────────────────
old1 = "  const [fontSize, setFontSize] = useState(40)"
new1 = """  const [fontSize, setFontSize] = useState(40)
  const [letterSpacing, setLetterSpacing] = useState(0)
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>('center')
  const [isBold, setIsBold] = useState(false)
  const [isItalic, setIsItalic] = useState(false)
  const [isUppercase, setIsUppercase] = useState(false)
  const [textShadow, setTextShadow] = useState(false)
  const [textOutline, setTextOutline] = useState(false)
  const [textDirection, setTextDirection] = useState<'horizontal' | 'vertical'>('horizontal')"""

if old1 in content:
    content = content.replace(old1, new1)
    print('✓ Added new state variables')
else:
    print('✗ fontSize state NOT FOUND')

# ── 2. Update fonts array to objects ──────────────────────────────────────
old2 = "  const fonts = ['Arial Black', 'Impact', 'Georgia', 'Courier New', 'Trebuchet MS', 'Verdana']"
new2 = """  const fonts = [
    { label: 'Arial Black',     value: 'Arial Black, sans-serif' },
    { label: 'Impact',          value: 'Impact, sans-serif' },
    { label: 'Georgia',         value: 'Georgia, serif' },
    { label: 'Courier New',     value: 'Courier New, monospace' },
    { label: 'Trebuchet MS',    value: 'Trebuchet MS, sans-serif' },
    { label: 'Verdana',         value: 'Verdana, sans-serif' },
    { label: 'Times New Roman', value: 'Times New Roman, serif' },
    { label: 'Palatino',        value: 'Palatino, serif' },
    { label: 'Garamond',        value: 'Garamond, serif' },
    { label: 'Comic Sans MS',   value: 'Comic Sans MS, cursive' },
    { label: 'Candara',         value: 'Candara, sans-serif' },
    { label: 'Optima',          value: 'Optima, sans-serif' },
  ]"""

if old2 in content:
    content = content.replace(old2, new2)
    print('✓ Updated fonts array')
else:
    print('✗ fonts array NOT FOUND')

# ── 3. Replace the TEXT TAB section ───────────────────────────────────────
# Find the text tab block using regex
text_tab_pattern = re.compile(
    r'\{/\* TEXT TAB \*/\}.*?\{/\* UPLOAD TAB \*/\}',
    re.DOTALL
)

new_text_tab = '''            {/* TEXT TAB */}
            {activeTab === 'text' && (
              <>
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-widest font-mono">Your Text</label>
                  <input type="text" value={textInput}
                    onChange={e => setTextInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addText()}
                    placeholder="Type something..."
                    className="w-full mt-1 bg-[#1e1e1e] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white outline-none focus:border-[#e8ff47]"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-widest font-mono">Font</label>
                  <select value={selectedFont} onChange={e => setSelectedFont(e.target.value)}
                    className="w-full mt-1 bg-[#1e1e1e] border border-[#2a2a2a] rounded px-3 py-2 text-sm text-white outline-none">
                    {fonts.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </div>
                <div>
                  <div className="flex justify-between items-center">
                    <label className="text-xs text-gray-500 uppercase tracking-widest font-mono">Size</label>
                    <input type="number" min={8} max={120} value={fontSize}
                      onChange={e => setFontSize(Number(e.target.value))}
                      className="w-14 bg-[#1e1e1e] border border-[#2a2a2a] rounded px-2 py-1 text-xs text-white outline-none text-center focus:border-[#e8ff47]"
                    />
                  </div>
                  <input type="range" min={8} max={120} value={fontSize}
                    onChange={e => setFontSize(Number(e.target.value))}
                    className="w-full mt-1 accent-[#e8ff47]" />
                </div>
                <div>
                  <div className="flex justify-between items-center">
                    <label className="text-xs text-gray-500 uppercase tracking-widest font-mono">Letter Spacing</label>
                    <span className="text-xs text-[#e8ff47] font-mono">{letterSpacing}</span>
                  </div>
                  <input type="range" min={-5} max={30} value={letterSpacing}
                    onChange={e => setLetterSpacing(Number(e.target.value))}
                    className="w-full mt-1 accent-[#e8ff47]" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-widest font-mono">Text Color</label>
                  <div className="flex gap-2 mt-2 flex-wrap items-center">
                    {['#ffffff','#111111','#e63946','#457b9d','#f4a261','#2a9d8f','#e8ff47','#ff6b35','#a855f7'].map(c => (
                      <button key={c} onClick={() => setTextColor(c)}
                        style={{ background: c, border: c === '#ffffff' ? '1px solid #555' : 'none' }}
                        className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${textColor === c ? 'border-[#e8ff47]' : 'border-transparent'}`}
                      />
                    ))}
                    <input type="color" value={textColor}
                      onChange={e => setTextColor(e.target.value)}
                      className="w-7 h-7 rounded-full cursor-pointer overflow-hidden" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-widest font-mono">Alignment</label>
                  <div className="flex gap-2 mt-1">
                    {(['left','center','right'] as const).map(a => (
                      <button key={a} onClick={() => setTextAlign(a)}
                        className={`flex-1 py-2 rounded text-xs font-mono transition-all ${textAlign === a ? 'bg-[#e8ff47] text-black' : 'bg-[#1e1e1e] text-gray-400 border border-[#2a2a2a]'}`}>
                        {a === 'left' ? '⬛◻◻' : a === 'center' ? '◻⬛◻' : '◻◻⬛'}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-widest font-mono">Direction</label>
                  <div className="flex gap-2 mt-1">
                    <button onClick={() => setTextDirection('horizontal')}
                      className={`flex-1 py-2 rounded text-xs font-mono transition-all ${textDirection === 'horizontal' ? 'bg-[#e8ff47] text-black' : 'bg-[#1e1e1e] text-gray-400 border border-[#2a2a2a]'}`}>
                      — Horizontal
                    </button>
                    <button onClick={() => setTextDirection('vertical')}
                      className={`flex-1 py-2 rounded text-xs font-mono transition-all ${textDirection === 'vertical' ? 'bg-[#e8ff47] text-black' : 'bg-[#1e1e1e] text-gray-400 border border-[#2a2a2a]'}`}>
                      ↕ Vertical
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 uppercase tracking-widest font-mono">Effects</label>
                  <div className="grid grid-cols-3 gap-2 mt-1">
                    <button onClick={() => setIsBold(b => !b)}
                      className={`py-2 rounded text-xs font-bold transition-all ${isBold ? 'bg-[#e8ff47] text-black' : 'bg-[#1e1e1e] text-gray-400 border border-[#2a2a2a]'}`}>
                      Bold
                    </button>
                    <button onClick={() => setIsItalic(i => !i)}
                      className={`py-2 rounded text-xs italic transition-all ${isItalic ? 'bg-[#e8ff47] text-black' : 'bg-[#1e1e1e] text-gray-400 border border-[#2a2a2a]'}`}>
                      Italic
                    </button>
                    <button onClick={() => setIsUppercase(u => !u)}
                      className={`py-2 rounded text-xs font-mono transition-all ${isUppercase ? 'bg-[#e8ff47] text-black' : 'bg-[#1e1e1e] text-gray-400 border border-[#2a2a2a]'}`}>
                      AA
                    </button>
                    <button onClick={() => setTextShadow(s => !s)}
                      className={`py-2 rounded text-xs font-mono transition-all ${textShadow ? 'bg-[#e8ff47] text-black' : 'bg-[#1e1e1e] text-gray-400 border border-[#2a2a2a]'}`}>
                      Shadow
                    </button>
                    <button onClick={() => setTextOutline(o => !o)}
                      className={`col-span-2 py-2 rounded text-xs font-mono transition-all ${textOutline ? 'bg-[#e8ff47] text-black' : 'bg-[#1e1e1e] text-gray-400 border border-[#2a2a2a]'}`}>
                      Outline
                    </button>
                  </div>
                </div>
                <button onClick={addText}
                  className="w-full bg-[#e8ff47] text-black py-3 rounded font-bold text-sm tracking-wide hover:opacity-85 transition-opacity">
                  + Add to Shirt
                </button>
                <button onClick={deleteSelected}
                  className="w-full border border-red-800 text-red-400 py-2 rounded text-sm hover:bg-red-900/20 transition-colors">
                  Delete Selected
                </button>
              </>
            )}
            {/* UPLOAD TAB */}'''

match = text_tab_pattern.search(content)
if match:
    content = content[:match.start()] + new_text_tab + content[match.end():]
    print('✓ Replaced text tab UI')
else:
    print('✗ Text tab pattern NOT FOUND')

# ── 4. Replace addText function ────────────────────────────────────────────
# Find addText by line number approach
lines = content.split('\n')
start_line = None
end_line = None
brace_count = 0
in_func = False

for i, line in enumerate(lines):
    if 'const addText = () => {' in line:
        start_line = i
        in_func = True
    if in_func:
        brace_count += line.count('{') - line.count('}')
        if brace_count <= 0 and i > start_line:
            end_line = i
            break

if start_line is not None and end_line is not None:
    new_addtext = """  const addText = () => {
    if (!fabricCanvas || !textInput.trim()) return
    import('fabric').then(({ IText, Shadow }) => {
      const canvasEl = canvasRef.current
      const overlay = document.querySelector('[data-print-area]') as HTMLElement
      let spawnX = 280
      let spawnY = 378
      if (overlay && canvasEl) {
        const canvasRect = canvasEl.getBoundingClientRect()
        const overlayRect = overlay.getBoundingClientRect()
        const scaleX = canvasEl.width / canvasRect.width
        const scaleY = canvasEl.height / canvasRect.height
        const paLeft  = (overlayRect.left - canvasRect.left) * scaleX
        const paTop   = (overlayRect.top  - canvasRect.top)  * scaleY
        const paWidth  = overlayRect.width  * scaleX
        const paHeight = overlayRect.height * scaleY
        spawnX = paLeft + paWidth  / 2
        spawnY = paTop  + paHeight / 2
      }
      const displayText = isUppercase ? textInput.toUpperCase() : textInput
      const textObj = new IText(displayText, {
        left: spawnX,
        top: spawnY,
        fontFamily: selectedFont,
        fontSize: fontSize,
        fill: textColor,
        fontWeight: isBold ? 'bold' : 'normal',
        fontStyle: isItalic ? 'italic' : 'normal',
        textAlign: textAlign,
        charSpacing: letterSpacing * 10,
        angle: textDirection === 'vertical' ? 90 : 0,
        originX: 'center',
        originY: 'center',
        shadow: textShadow ? new Shadow({ color: 'rgba(0,0,0,0.6)', blur: 8, offsetX: 3, offsetY: 3 }) : undefined,
        stroke: textOutline ? '#000000' : undefined,
        strokeWidth: textOutline ? 2 : 0,
      })
      fabricCanvas.add(textObj)
      fabricCanvas.setActiveObject(textObj)
      fabricCanvas.renderAll()
      setTextInput('')
    })
  }"""
    lines[start_line:end_line+1] = new_addtext.split('\n')
    content = '\n'.join(lines)
    print('✓ Replaced addText function')
else:
    print('✗ addText function NOT FOUND')

with open('/Users/deniseplumb/Desktop/tee-studio/app/components/DesignerCanvas.tsx', 'w') as f:
    f.write(content)

print('Done!')
