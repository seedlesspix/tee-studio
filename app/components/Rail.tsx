'use client'

// Rail — the designer's tool selector.
//
// D0 restructure [chrome] (move-not-rewrite): the tab-nav grid extracted VERBATIM
// from DesignerCanvas's left aside — same grid, same three text tabs, same
// active/inactive classes. Drives the parent's activeTab via onSelectTab; the
// panel below still reads activeTab unchanged. Renders in the same spot (inside
// the aside) — no re-parenting. Behavior-neutral; the human backstop is the gate.
//
// Phase 2 (sealed target, NOT now): restyle to the vertical ICON rail
// (Products · Text · Upload · Art · Names & Numbers); flip the active state from
// red (`bg-[#dd3333]`) to a QUIET non-red treatment per the locked red-vocabulary
// rule (red = ACTION only); and add the net-new entries — Products = Design
// Portability, Names & Numbers, Layers (each its own build). Kept RED here so this
// step stays a pure move, not move+change.
type Tab = 'text' | 'upload' | 'clipart'

export default function Rail({
  activeTab,
  onSelectTab,
}: {
  activeTab: string
  onSelectTab: (tab: Tab) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-1 p-2 bg-gray-100 m-3 rounded-lg">
      {(['text', 'upload', 'clipart'] as const).map(tab => (
        <button key={tab} onClick={() => onSelectTab(tab)}
          className={`py-2 rounded text-xs font-mono capitalize transition-all ${
            activeTab === tab ? 'bg-[#dd3333] text-white font-bold' : 'text-gray-800 hover:text-white'
          }`}>
          {tab}
        </button>
      ))}
    </div>
  )
}
