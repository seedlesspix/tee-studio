'use client'
import { useState } from 'react'
import ClipartPanel, { type DecalMeta } from './ClipartPanel'

// ArtBrowser — wraps ClipartPanel with a Clipart | Designs mode toggle so decals (pre-made "designs")
// browse as their OWN section, separate from generic clipart. It owns only the local toggle state; all
// the browse/fetch/placement logic stays in ClipartPanel. Rendered by both the desktop SelectionPanel
// Art tab and the mobile MobileArtBand, so the two surfaces share one toggle implementation.
export default function ArtBrowser({
  printMethod,
  onSelect,
  horizontal = false,
  showSearch = true,
}: {
  printMethod: string
  onSelect: (url: string, fileType: string, decal?: DecalMeta) => void
  horizontal?: boolean
  showSearch?: boolean
}) {
  const [mode, setMode] = useState<'clipart' | 'design'>('clipart')
  return (
    <div className={horizontal ? 'flex h-full flex-col gap-1.5' : 'flex flex-col gap-2'}>
      {/* Clipart | Designs toggle. Quiet non-red selected state (surface fill) per the designer
          red-vocabulary rule — red is reserved for primary actions, not active state. Shown only while
          browsing (hidden in the mobile edit view, where showSearch is false, to save vertical space). */}
      {showSearch && (
        <div className="flex shrink-0 gap-1 rounded-lg bg-[#1e1e1e] p-1">
          {(['clipart', 'design'] as const).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 rounded-md font-mono transition-colors ${horizontal ? 'px-3 py-1 text-[11px]' : 'px-3 py-1.5 text-xs'} ${
                mode === m ? 'bg-[#2a2a2a] text-white' : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {m === 'clipart' ? 'Clipart' : 'Designs'}
            </button>
          ))}
        </div>
      )}
      <div className={horizontal ? 'min-h-0 flex-1' : ''}>
        <ClipartPanel
          printMethod={printMethod}
          onSelect={onSelect}
          mode={mode}
          horizontal={horizontal}
          showSearch={showSearch}
        />
      </div>
    </div>
  )
}
