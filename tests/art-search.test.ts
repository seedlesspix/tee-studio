import { describe, it, expect } from 'vitest'
import { matchesArtSearch, sortArt, hasActiveCategory } from '../app/lib/artSearch'

describe('matchesArtSearch — name, tags, Design #', () => {
  const eagle = { name: 'Golden Eagle', tags: ['bird', 'patriotic'], decal_number: 2491 }
  it('matches name, tag and design number, case-insensitively', () => {
    expect(matchesArtSearch(eagle, 'eagle')).toBe(true)
    expect(matchesArtSearch(eagle, 'PATRIO')).toBe(true)
    expect(matchesArtSearch(eagle, '249')).toBe(true)
    expect(matchesArtSearch(eagle, 'T2491')).toBe(true)
    expect(matchesArtSearch(eagle, 'fish')).toBe(false)
  })
  it('empty query matches everything; missing tags/number are fine', () => {
    expect(matchesArtSearch({ name: 'x' }, '   ')).toBe(true)
    expect(matchesArtSearch({ name: 'x', tags: null, decal_number: null }, '1')).toBe(false)
  })
})

describe('sortArt', () => {
  const items = [
    { name: 'Bee', created_at: '2026-10-01T00:00:00Z', sort_order: 1, decal_number: 30 },
    { name: 'Ant', created_at: '2026-10-03T00:00:00Z', sort_order: 2, decal_number: null },
    { name: 'Cat', created_at: null, sort_order: 3, decal_number: 10 },
    { name: 'Dog', created_at: '2026-10-02T00:00:00Z', sort_order: 4, decal_number: 20 },
  ]
  const names = (arr: { name: string }[]) => arr.map(i => i.name)
  it('newest first, items without a date last', () => expect(names(sortArt(items, 'newest'))).toEqual(['Ant', 'Dog', 'Bee', 'Cat']))
  it('oldest first, items without a date last', () => expect(names(sortArt(items, 'oldest'))).toEqual(['Bee', 'Dog', 'Ant', 'Cat']))
  it('name A–Z', () => expect(names(sortArt(items, 'name'))).toEqual(['Ant', 'Bee', 'Cat', 'Dog']))
  it('design # ascending, unnumbered last', () => expect(names(sortArt(items, 'design'))).toEqual(['Cat', 'Dog', 'Bee', 'Ant']))
  it('does not mutate the input', () => { const copy = [...items]; sortArt(items, 'name'); expect(items).toEqual(copy) })
})

describe('hasActiveCategory — off means gone', () => {
  const active = new Set(['a', 'b'])
  it('offered when any category is on; hidden when none are', () => {
    expect(hasActiveCategory({ category_ids: ['x', 'b'] }, active)).toBe(true)
    expect(hasActiveCategory({ category_ids: ['x', 'y'] }, active)).toBe(false)
    expect(hasActiveCategory({ category_ids: [] }, active)).toBe(false)
    expect(hasActiveCategory({ category_ids: null }, active)).toBe(false)
  })
})
