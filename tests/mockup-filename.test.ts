import { describe, it, expect } from 'vitest'
import { parseMockupFilename, normalizeZone, normalizeColorKey } from '../app/lib/mockupFilename'

describe('parseMockupFilename', () => {
  it('parses the standard convention', () => {
    expect(parseMockupFilename('2001_White_LeftSleeve.png')).toEqual({ style: '2001', color: 'White', zone: 'left_sleeve', isOverlay: false })
  })
  it('handles every zone token', () => {
    expect(parseMockupFilename('2001_Black_RightSleeve.png')?.zone).toBe('right_sleeve')
    expect(parseMockupFilename('2001_Black_Back.jpg')?.zone).toBe('back')
    expect(parseMockupFilename('2001_Black_Front.png')?.zone).toBe('front')
    expect(parseMockupFilename('5001_Red_HatBack.png')?.zone).toBe('hat_back')
  })
  it('joins a multi-word color (first=style, last=zone, middle=color)', () => {
    expect(parseMockupFilename('2001_Light_Blue_LeftSleeve.png')).toEqual({ style: '2001', color: 'Light Blue', zone: 'left_sleeve', isOverlay: false })
  })
  it('returns zone:null for an unrecognized position — flag, do not mis-assign', () => {
    expect(parseMockupFilename('2001_White_Collar.png')).toEqual({ style: '2001', color: 'White', zone: null, isOverlay: false })
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

  it('accepts a multi-word color BOTH ways (joined or underscored), any case', () => {
    // ColumbiaBlue (one token) and Columbia_Blue (two tokens) parse; normalizeColorKey collapses both
    // (and any casing) to the same key so they resolve to the same product color.
    const joined = parseMockupFilename('2001_ColumbiaBlue_Front.png')!
    const under = parseMockupFilename('2001_Columbia_Blue_Front.png')!
    expect(joined.zone).toBe('front')
    expect(under.zone).toBe('front')
    expect(joined.color).toBe('ColumbiaBlue')
    expect(under.color).toBe('Columbia Blue')
    expect(normalizeColorKey(joined.color)).toBe(normalizeColorKey(under.color))
    expect(normalizeColorKey('COLUMBIA blue')).toBe('columbiablue')
  })

  it('resolves a hat back written as HatBack OR Hat_Back — not the shirt Back', () => {
    expect(parseMockupFilename('5001_Red_HatBack.png')).toEqual({ style: '5001', color: 'Red', zone: 'hat_back', isOverlay: false })
    expect(parseMockupFilename('5001_Red_Hat_Back.png')).toEqual({ style: '5001', color: 'Red', zone: 'hat_back', isOverlay: false })
    // A shirt Back is still Back, even with a multi-word color ending in an ordinary word.
    expect(parseMockupFilename('2001_Columbia_Blue_Back.png')).toEqual({ style: '2001', color: 'Columbia Blue', zone: 'back', isOverlay: false })
  })

  it('resolves a sleeve written as LeftSleeve OR Left_Sleeve', () => {
    expect(parseMockupFilename('2001_Navy_Left_Sleeve.png')?.zone).toBe('left_sleeve')
    expect(parseMockupFilename('2001_Navy_LeftSleeve.png')?.zone).toBe('left_sleeve')
    expect(parseMockupFilename('2001_Light_Blue_Right_Sleeve.png')).toEqual({ style: '2001', color: 'Light Blue', zone: 'right_sleeve', isOverlay: false })
  })

  it('flags a foreground OVERLAY via the trailing _Overlay token (layered mockups)', () => {
    expect(parseMockupFilename('4001_Military_Front_Overlay.png')).toEqual({ style: '4001', color: 'Military', zone: 'front', isOverlay: true })
    // overlay-ness strips before zone parse, so multi-word colors + 2-token zones still resolve
    expect(parseMockupFilename('5001_Light_Blue_Hat_Back_Overlay.png')).toEqual({ style: '5001', color: 'Light Blue', zone: 'hat_back', isOverlay: true })
    // base mockups are isOverlay:false
    expect(parseMockupFilename('4001_Military_Front.png')?.isOverlay).toBe(false)
  })
})
