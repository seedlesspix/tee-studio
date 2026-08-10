import { Loader2 } from 'lucide-react'

// Small shared "working…" spinner. Inherits the current text color (currentColor) so it reads on any
// button/surface. Used wherever a save/snapshot/cart wait runs so customers see something happening.
export default function Spinner({ size = 14, className = '' }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={`animate-spin ${className}`} aria-hidden="true" />
}
