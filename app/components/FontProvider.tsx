'use client'
import { useEffect } from 'react'
import { supabase } from '../lib/supabase'

// Runtime font loader — Font Management, Phase A.
//
// Registers a browser FontFace for every `designer_fonts` row that has a `file_url` (an admin-uploaded
// font), so uploaded fonts render on the shirt + in the picker WITHOUT a code change. The face's family
// is the base token of the row's CSS `value` (e.g. "Bebas Neue" from "Bebas Neue, sans-serif") — the
// SAME string the designer applies as fontFamily, so it resolves exactly.
//
// Phase A note: the existing 58 fonts have file_url = null (still served by the hardcoded @font-face in
// globals.css + the Google <link> in layout.tsx), so this only covers NEW uploads and runs harmlessly
// alongside them (identical family names). Phase B migrates the 58 to file_url and retires the hardcoded
// declarations, at which point this becomes the sole browser source for local fonts.
function baseFamily(value: string): string {
  return value.split(',')[0].trim().replace(/^['"]|['"]$/g, '')
}

export default function FontProvider() {
  useEffect(() => {
    if (typeof document === 'undefined' || !document.fonts || typeof FontFace === 'undefined') return
    let cancelled = false
    supabase
      .from('designer_fonts')
      .select('value, file_url')
      .not('file_url', 'is', null)
      .eq('is_active', true)
      .then(({ data }) => {
        if (cancelled || !data) return
        for (const row of data) {
          if (!row.file_url) continue
          const family = baseFamily(row.value)
          // Idempotent: skip a family already registered (re-mount / HMR / duplicate rows).
          if (Array.from(document.fonts).some(f => f.family === family)) continue
          try {
            // display:swap → show a fallback immediately and swap when the file loads (never invisible
            // text), matching the Google <link>'s display=swap behavior.
            const face = new FontFace(family, `url("${row.file_url}")`, { display: 'swap' })
            face.load()
              .then(loaded => { if (!cancelled) document.fonts.add(loaded) })
              .catch(() => { /* a bad/unreachable file just doesn't register — the picker still lists it */ })
          } catch { /* FontFace ctor threw (malformed family) — ignore */ }
        }
      })
    return () => { cancelled = true }
  }, [])
  return null
}
