import { describe, it, expect } from 'vitest'
import { parseMockupFilename, normalizeZone } from '../app/lib/mockupFilename'

describe('parseMockupFilename', () => {
  it('parses the standard convention', () => {
    expect(parseMockupFilename('2001_White_LeftSleeve.png')).toEqual({ style: '2001', color: 'White', zone: 'left_sleeve' })
  })
  it('handles every zone token', () => {
    expect(parseMockupFilename('2001_Black_RightSleeve.png')?.zone).toBe('right_sleeve')
    expect(parseMockupFilename('2001_Black_Back.jpg')?.zone).toBe('back')
    expect(parseMockupFilename('2001_Black_Front.png')?.zone).toBe('front')
    expect(parseMockupFilename('5001_Red_HatBack.png')?.zone).toBe('hat_back')
  })
  it('joins a multi-word color (first=style, last=zone, middle=color)', () => {
    expect(parseMockupFilename('2001_Light_Blue_LeftSleeve.png')).toEqual({ style: '2001', color: 'Light Blue', zone: 'left_sleeve' })
  })
  it('returns zone:null for an unrecognized position — flag, do not mis-assign', () => {
    expect(parseMockupFilename('2001_White_Collar.png')).toEqual({ style: '2001', color: 'White', zone: null })
  })
  it('returns null when there are too few tokens', () => {
    expect(parseMockupFilename('2001_White.png')).toBeNull()
    expect(parseMockupFilename('random.png')).toBeNull()
  })
  it('is case/separator tolerant on the zone', () => {
    expect(normalizeZone('left-sleeve')).toBe('left_sleeve')
    expect(normalizeZone('LEFTSLEEVE')).toBe('left_sleeve')
    expect(normalizeZone('Hat Back')).toBe('hat_back')
    expect(normalizeZone('nonsense')).toBeNull()
  })
})
