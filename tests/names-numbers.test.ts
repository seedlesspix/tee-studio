import { describe, it, expect } from 'vitest'
import { parseBulkRoster, substituteRosterEntry, rosterShirtCount, NN_ROLE_PROP } from '../app/lib/namesNumbers'

describe('names & numbers — bulk roster parsing', () => {
  it('parses tab-separated "Name Number Size Qty"', () => {
    const r = parseBulkRoster('SMITH\t12\tL\t2\nJONES\t8\tM\t1')
    expect(r).toEqual([
      { name: 'SMITH', number: '12', size: 'L', qty: 2 },
      { name: 'JONES', number: '8', size: 'M', qty: 1 },
    ])
  })

  it('parses comma-separated and applies the default size + qty 1', () => {
    const r = parseBulkRoster('SMITH, 12', 'XL')
    expect(r).toEqual([{ name: 'SMITH', number: '12', size: 'XL', qty: 1 }])
  })

  it('parses a bare "NAME NUMBER" line (trailing numeric token)', () => {
    expect(parseBulkRoster('DE LA CRUZ 24')).toEqual([{ name: 'DE LA CRUZ', number: '24', size: '', qty: 1 }])
  })

  it('skips a header row and blank lines', () => {
    const r = parseBulkRoster('Name\tNumber\tSize\n\nSMITH\t12\tL\n')
    expect(r).toHaveLength(1)
    expect(r[0].name).toBe('SMITH')
  })

  it('rosterShirtCount sums qty over rows with content only', () => {
    const roster = [
      { name: 'SMITH', number: '12', size: 'L', qty: 2 },
      { name: '', number: '', size: 'M', qty: 5 }, // empty -> ignored
      { name: 'JONES', number: '', size: 'M', qty: 3 },
    ]
    expect(rosterShirtCount(roster)).toBe(5)
  })
})

describe('names & numbers — placeholder substitution (shared by preview + per-entry cut files)', () => {
  const objects = [
    { type: 'IText', text: 'TEAM LOGO' },                         // not a placeholder
    { type: 'IText', text: 'NAME', [NN_ROLE_PROP]: 'name' },      // name placeholder
    { type: 'IText', text: '00', [NN_ROLE_PROP]: 'number' },      // number placeholder
    { type: 'Image', _isCurvedText: true, text: 'NAME', _originalText: 'NAME', [NN_ROLE_PROP]: 'name' }, // curved name
  ]

  it('replaces only placeholders, leaving other objects untouched', () => {
    const out = substituteRosterEntry(objects, { name: 'SMITH', number: '12', size: 'L', qty: 1 })
    expect(out[0]).toBe(objects[0]) // pass-through (same reference)
    expect(out[1].text).toBe('SMITH')
    expect(out[2].text).toBe('12')
  })

  it('substitutes the curved-text bake source (_originalText) too', () => {
    const out = substituteRosterEntry(objects, { name: 'JONES', number: '8', size: 'M', qty: 1 })
    expect(out[3].text).toBe('JONES')
    expect(out[3]._originalText).toBe('JONES')
  })

  it('does not mutate the input objects', () => {
    substituteRosterEntry(objects, { name: 'X', number: 'Y', size: '', qty: 1 })
    expect(objects[1].text).toBe('NAME')
    expect(objects[3]._originalText).toBe('NAME')
  })
})
