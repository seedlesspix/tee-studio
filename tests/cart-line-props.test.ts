import { describe, it, expect } from 'vitest'
import { formatDesiredBy, visibleLineProps, NOTES_PROPERTY_MAX } from '../app/lib/cartLineProps'

describe('formatDesiredBy', () => {
  it('formats an ISO date for staff, with no timezone drift', () => {
    expect(formatDesiredBy('2026-11-01')).toBe('Sun, Nov 1, 2026')
    expect(formatDesiredBy('2026-02-28')).toBe('Sat, Feb 28, 2026')
  })
  it('rejects junk and impossible dates', () => {
    expect(formatDesiredBy('2026-02-30')).toBeNull()
    expect(formatDesiredBy('tomorrow')).toBeNull()
    expect(formatDesiredBy(null)).toBeNull()
    expect(formatDesiredBy('')).toBeNull()
  })
})

describe('visibleLineProps', () => {
  it('adds both properties when present', () => {
    expect(visibleLineProps({ desiredBy: '2026-11-01', notes: 'Rush — team photo Friday' })).toEqual({
      'Desired by': 'Sun, Nov 1, 2026',
      'Design notes': 'Rush — team photo Friday',
    })
  })
  it('omits what is blank or invalid', () => {
    expect(visibleLineProps({ desiredBy: null, notes: '   ' })).toEqual({})
    expect(visibleLineProps({ desiredBy: 'bad', notes: null })).toEqual({})
  })
  it('collapses whitespace and truncates very long notes', () => {
    expect(visibleLineProps({ notes: 'line one\n\n  line two' })['Design notes']).toBe('line one line two')
    const long = 'x'.repeat(NOTES_PROPERTY_MAX + 50)
    const out = visibleLineProps({ notes: long })['Design notes']
    expect(out.length).toBe(NOTES_PROPERTY_MAX)
    expect(out.endsWith('…')).toBe(true)
  })
})
