import { describe, expect, it } from 'vitest'
import { isMac } from './platform'

describe('isMac', () => {
  it.each([
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Electron/44.5.1',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15'
  ])('recognizes %s', (userAgent) => {
    expect(isMac(userAgent)).toBe(true)
  })

  it.each([
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152.0.0.0',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/152.0.0.0',
    ''
  ])('does not mistake %j for macOS', (userAgent) => {
    expect(isMac(userAgent)).toBe(false)
  })
})
