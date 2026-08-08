'use client'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { resolveString } from '../lib/uiStrings'

// Client-side wording resolver (BETA item 9). Loads the sparse admin overrides from `ui_strings` once,
// then `t(key)` = override ?? code default. Unedited strings render their default immediately (the
// overrides map starts empty), so there's no flash for anything that hasn't been reworded.

type TFn = (key: string, fallback?: string) => string
const StringsContext = createContext<TFn>((key, fallback) => resolveString(key, null, fallback))

export function useT(): TFn {
  return useContext(StringsContext)
}

export default function StringsProvider({ children }: { children: ReactNode }) {
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  useEffect(() => {
    let cancelled = false
    supabase.from('ui_strings').select('key, value').then(({ data }) => {
      if (cancelled || !data) return
      const map: Record<string, string> = {}
      for (const r of data) map[r.key] = r.value
      setOverrides(map)
    })
    return () => { cancelled = true }
  }, [])
  const t = useMemo<TFn>(() => (key: string, fallback?: string) => resolveString(key, overrides, fallback), [overrides])
  return <StringsContext.Provider value={t}>{children}</StringsContext.Provider>
}
