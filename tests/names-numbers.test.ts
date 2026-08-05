import { describe, it, expect } from 'vitest'
import { parseBulkRoster, substituteRosterEntry, rosterShirtCount, rosterSizeQuantities, rosterValue, condensedScaleX, NN_ROLE_PROP } from '../app/lib/namesNumbers'

describe('names & numbers — bulk roster parsing', () => {
  it('parses tab-separated "Name Number Size Qty" (name uppercased, title empty)', () => {
    const r = parseBulkRoster('SMITH\t12\tL\t2\nJONES\t8\tM\t1')
    expect(r).toEqual([
      { name: 'SMITH', number: '12', title: '', size: 'L', qty: 2 },
      { name: 'JONES', number: '8', title: '', size: 'M', qty: 1 },
    ])
  })

  it('parses comma-separated and applies the default size + qty 1', () => {
    const r = parseBulkRoster('SMITH, 12', 'XL')
    expect(r).toEqual([{ name: 'SMITH', number: '12', title: '', size: 'XL', qty: 1 }])
  })

  it('force-uppercases the pasted name (kills "Plumb vs plumb" ambiguity)', () => {
    expect(parseBulkRoster('plumb, 7')[0].name).toBe('PLUMB')
    expect(parseBulkRoster('de la cruz 24')[0].name).toBe('DE LA CRUZ')
  })

  it('parses a bare "NAME NUMBER" line (trailing numeric token)', () => {
    expect(parseBulkRoster('DE LA CRUZ 24')).toEqual([{ name: 'DE LA CRUZ', number: '24', title: '', size: '', qty: 1 }])
  })

  it('skips a header row and blank lines', () => {
    const r = parseBulkRoster('Name\tNumber\tSize\n\nSMITH\t12\tL\n')
    expect(r).toHaveLength(1)
    expect(r[0].name).toBe('SMITH')
  })

  it('reads Title as the optional 5th positional column (template order)', () => {
    const r = parseBulkRoster('SMITH, 12, L, 1, captain\nJONES, 8, M, 1')
    expect(r[0]).toEqual({ name: 'SMITH', number: '12', title: 'CAPTAIN', size: 'L', qty: 1 })
    expect(r[1].title).toBe('') // 4-column row still works, no title
  })

  it('maps columns by header when a header row is present (any order)', () => {
    const r = parseBulkRoster('Name,Number,Title,Size,Qty\nSMITH,12,coach,L,2')
    expect(r[0]).toEqual({ name: 'SMITH', number: '12', title: 'COACH', size: 'L', qty: 2 })
  })

  it('rosterShirtCount sums qty over rows with content only (name/number/title)', () => {
    const roster = [
      { name: 'SMITH', number: '12', title: '', size: 'L', qty: 2 },
      { name: '', number: '', title: '', size: 'M', qty: 5 }, // empty -> ignored
      { name: '', number: '', title: 'CAPTAIN', size: 'M', qty: 3 }, // title-only counts
    ]
    expect(rosterShirtCount(roster)).toBe(5)
  })
})

describe('names & numbers — rosterValue (force uppercase for text, numbers untouched)', () => {
  const e = { name: 'plumb', number: '07', title: 'captain', size: 'L', qty: 1 }
  it('uppercases name and title, leaves number as typed', () => {
    expect(rosterValue(e, 'name')).toBe('PLUMB')
    expect(rosterValue(e, 'title')).toBe('CAPTAIN')
    expect(rosterValue(e, 'number')).toBe('07')
  })
})

describe('names & numbers — placeholder substitution (shared by preview + per-entry cut files)', () => {
  const objects = [
    { type: 'IText', text: 'TEAM LOGO' },                         // not a placeholder
    { type: 'IText', text: 'NAME', [NN_ROLE_PROP]: 'name' },      // name placeholder
    { type: 'IText', text: '00', [NN_ROLE_PROP]: 'number' },      // number placeholder
    { type: 'IText', text: 'TITLE', [NN_ROLE_PROP]: 'title' },    // title placeholder
    { type: 'Image', _isCurvedText: true, text: 'NAME', _originalText: 'NAME', [NN_ROLE_PROP]: 'name' }, // curved name
  ]

  it('replaces every role, uppercasing text, leaving other objects untouched', () => {
    const out = substituteRosterEntry(objects, { name: 'smith', number: '12', title: 'captain', size: 'L', qty: 1 })
    expect(out[0]).toBe(objects[0]) // pass-through (same reference)
    expect(out[1].text).toBe('SMITH')
    expect(out[2].text).toBe('12')
    expect(out[3].text).toBe('CAPTAIN')
  })

  it('substitutes the curved-text bake source (_originalText) too', () => {
    const out = substituteRosterEntry(objects, { name: 'jones', number: '8', title: '', size: 'M', qty: 1 })
    expect(out[4].text).toBe('JONES')
    expect(out[4]._originalText).toBe('JONES')
  })

  it('does not mutate the input objects', () => {
    substituteRosterEntry(objects, { name: 'X', number: 'Y', title: 'Z', size: '', qty: 1 })
    expect(objects[1].text).toBe('NAME')
    expect(objects[4]._originalText).toBe('NAME')
  })
})

describe('names & numbers — rosterSizeQuantities (roster drives the order quantities)', () => {
  const R = (name: string, number: string, size: string, qty: number, title = '') => ({ name, number, title, size, qty })

  it('sums content entries by size', () => {
    const q = rosterSizeQuantities([R('SMITH', '12', 'L', 2), R('JONES', '8', 'M', 1), R('LEE', '5', 'L', 1)])
    expect(q).toEqual({ L: 3, M: 1 })
  })

  it('grand total equals rosterShirtCount (order total stays consistent)', () => {
    const roster = [R('SMITH', '12', 'L', 2), R('', '', 'M', 5) /* no content: skipped */, R('LEE', '5', 'S', 3)]
    const q = rosterSizeQuantities(roster)
    const sum = Object.values(q).reduce((a, b) => a + b, 0)
    expect(sum).toBe(rosterShirtCount(roster))
    expect(sum).toBe(5)
  })

  it('skips empty/zero-qty rows and buckets an unsized entry under \'\'', () => {
    const q = rosterSizeQuantities([R('A', '1', '', 2), R('B', '2', 'L', 0), R('', '', 'M', 4)])
    expect(q).toEqual({ '': 2 })
  })
})

describe('names & numbers — condensedScaleX (keep height, shrink width to the box)', () => {
  it('leaves a value that already fits at its base scaleX', () => {
    expect(condensedScaleX(100, 200)).toBe(1)
    expect(condensedScaleX(100, 200, 0.9)).toBe(0.9)
  })

  it('condenses only enough to reach the box width when a value overflows', () => {
    // "DE LA CRUZ" is 300 wide in a 200 box -> squeeze to 2/3
    expect(condensedScaleX(300, 200)).toBeCloseTo(200 / 300)
    // base scaleX is the ceiling, not a multiplier on the fit
    expect(condensedScaleX(300, 200, 1.5)).toBeCloseTo(200 / 300)
  })

  it('never widens and is safe on degenerate input', () => {
    expect(condensedScaleX(50, 200, 0.8)).toBe(0.8) // fits -> stays condensed at base, not widened
    expect(condensedScaleX(0, 200)).toBe(1)         // no measured width -> base
    expect(condensedScaleX(100, 0)).toBe(1)         // no box -> base
  })
})
