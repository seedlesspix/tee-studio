'use client'
import { useT } from './StringsProvider'

// Two-tone brand wordmark, driven by the SINGLE Language string `app.name` (N3 fix). Denise edits ONE
// "name" field in the Language editor. The FIRST space marks where the brand red begins and is NOT
// rendered — so "PREP STATION" shows as PREPSTATION with STATION in red (like the old TEESTUDIO mark). The
// first segment renders in the surrounding text color, the rest in brand red. One field owns the name on
// every surface (designer, order, admin, login). Renders a Fragment so it drops into any existing wrapper
// (font size / weight / tracking / color) unchanged. A single-token name (no space) renders in one color.
export default function BrandMark() {
  const t = useT()
  const name = t('app.name', 'Prep Station')
  const sp = name.indexOf(' ')
  const first = sp === -1 ? name : name.slice(0, sp)
  const rest = sp === -1 ? '' : name.slice(sp + 1)
  return <>{first}{rest ? <span className="text-[#dd3333]">{rest}</span> : null}</>
}
