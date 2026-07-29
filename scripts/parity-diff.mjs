#!/usr/bin/env node
// Parity diff — compares a branch parity capture against its golden baseline,
// path by path, and exits non-zero on ANY difference. This is the gate:
// "zero diff across all fixtures" must be literally zero, not eyeballed.
//
//   node scripts/parity-diff.mjs golden/<file>.json branch/<file>.json
//   node scripts/parity-diff.mjs golden/ branch/        (diffs every matching file)
//
// Numbers are compared with a tiny epsilon (1e-6) so IEEE float noise doesn't
// register, while any real geometry shift does. Hash/string fields must match
// exactly. Run golden + branch on the SAME machine (PNG rasterization is
// machine-specific; the before/after diff is same-machine so it's valid).

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'

const EPS = 1e-6
const diffs = []

function walk(path, a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) > EPS) diffs.push(`${path}: ${a} → ${b}`)
    return
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (a !== b) diffs.push(`${path}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`)
    return
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      diffs.push(`${path}: array shape ${JSON.stringify(a)?.slice(0, 60)} → ${JSON.stringify(b)?.slice(0, 60)}`)
      return
    }
    a.forEach((_, i) => walk(`${path}[${i}]`, a[i], b[i]))
    return
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const k of keys) {
    if (!(k in a)) { diffs.push(`${path}.${k}: (absent in golden) → ${JSON.stringify(b[k])?.slice(0, 60)}`); continue }
    if (!(k in b)) { diffs.push(`${path}.${k}: ${JSON.stringify(a[k])?.slice(0, 60)} → (absent in branch)`); continue }
    walk(`${path}.${k}`, a[k], b[k])
  }
}

function diffFile(goldenPath, branchPath) {
  const g = JSON.parse(readFileSync(goldenPath, 'utf8'))
  const b = JSON.parse(readFileSync(branchPath, 'utf8'))
  const before = diffs.length
  walk(basename(goldenPath).replace(/\.json$/, ''), g, b)
  return diffs.length - before
}

const [aArg, bArg] = process.argv.slice(2)
if (!aArg || !bArg) {
  console.error('usage: node scripts/parity-diff.mjs <golden.json|dir> <branch.json|dir>')
  process.exit(2)
}

let compared = 0
if (statSync(aArg).isDirectory()) {
  for (const f of readdirSync(aArg).filter((f) => f.endsWith('.json')).sort()) {
    const bp = join(bArg, f)
    try { statSync(bp) } catch { diffs.push(`${f}: MISSING in branch`); continue }
    const n = diffFile(join(aArg, f), bp)
    console.log(`${n === 0 ? '✓' : '✗'} ${f}${n ? ` — ${n} diff(s)` : ''}`)
    compared++
  }
} else {
  const n = diffFile(aArg, bArg)
  console.log(`${n === 0 ? '✓' : '✗'} ${basename(aArg)}${n ? ` — ${n} diff(s)` : ''}`)
  compared++
}

console.log('')
if (diffs.length === 0) {
  console.log(`PARITY GREEN — zero diff across ${compared} file(s).`)
  process.exit(0)
}
console.log(`PARITY FAILED — ${diffs.length} difference(s):`)
for (const d of diffs.slice(0, 60)) console.log('  ' + d)
if (diffs.length > 60) console.log(`  … and ${diffs.length - 60} more`)
process.exit(1)
