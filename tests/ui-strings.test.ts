import { describe, it, expect } from 'vitest'
import { resolveString, format } from '../app/lib/uiStrings'

describe('resolveString (Language editor resolution)', () => {
  it('an admin override wins over everything', () => {
    expect(resolveString('method.screen_print', { 'method.screen_print': 'Screenprint' }, 'Print')).toBe('Screenprint')
  })
  it('falls back to the inline fallback when there is no override', () => {
    expect(resolveString('anything', {}, 'Original text')).toBe('Original text')
    expect(resolveString('anything', null, 'Original text')).toBe('Original text')
  })
  it('uses the registry default when there is no override and no fallback', () => {
    expect(resolveString('method.screen_print', {})).toBe('Print')
  })
  it('returns the key itself for an unknown key with no fallback (never blank)', () => {
    expect(resolveString('does.not.exist', null)).toBe('does.not.exist')
  })
})

describe('format (placeholder interpolation for error/notice wording)', () => {
  it('fills {name} placeholders', () => {
    expect(format('That file is {size} MB, max {max} MB.', { size: 12, max: 25 })).toBe('That file is 12 MB, max 25 MB.')
  })
  it('coerces numbers (incl. 0) to strings', () => {
    expect(format('{n} pages', { n: 0 })).toBe('0 pages')
  })
  it('repeats a placeholder and leaves unknown ones literal (visible, never blank)', () => {
    expect(format('{a}-{a} {b}', { a: 'x' })).toBe('x-x {b}')
  })
  it('is a no-op with no placeholders', () => {
    expect(format('plain text', { a: 1 })).toBe('plain text')
  })
})
