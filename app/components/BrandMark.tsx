'use client'
import { useT } from './StringsProvider'

// The two-tone brand wordmark, language-driven (rename N3/N4). part1 renders in the surrounding text
// color (currentColor), part2 in brand red — the "read-once identity" red the locked red-vocabulary rule
// allows. Both parts are editable in the Language admin (app.name.part1 / app.name.part2), so the brand
// name is owned in ONE place and updates every surface (designer, order, admin, login) at once — fixing
// the hardcoded marks that ignored the app.name edit. Renders a Fragment so it drops into any existing
// wrapper (font size / weight / tracking / color) with no visual change beyond the words themselves.
export default function BrandMark() {
  const t = useT()
  return <>{t('app.name.part1', 'Prep')}<span className="text-[#dd3333]">{t('app.name.part2', 'Station')}</span></>
}
