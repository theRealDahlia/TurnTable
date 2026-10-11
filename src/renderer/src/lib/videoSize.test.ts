import { describe, expect, it, vi } from 'vitest'
import { VIDEO_DEFAULT_WIDTH, VIDEO_MIN_WIDTH, clampVideoWidth, readSavedVideoWidth, saveVideoWidth, videoHeight, videoMaxWidth } from './videoSize'

const memory = (initial?: string) => {
  const store = { value: initial, getItem: vi.fn(() => store.value ?? null), setItem: vi.fn((_key: string, value: string) => void (store.value = value)) }
  return store
}

describe('video size limits', () => {
  it('keeps YouTube\'s 200-pixel minimum height at the smallest width', () => {
    expect(videoHeight(VIDEO_MIN_WIDTH)).toBeGreaterThanOrEqual(200)
    expect(videoHeight(VIDEO_MIN_WIDTH - 1)).toBeLessThan(200 + 1)
  })

  it('is 16:9', () => {
    expect(videoHeight(480)).toBe(270)
    expect(videoHeight(400)).toBe(225)
  })

  it('stays off the sidebar and below the top of the window', () => {
    // 1100 wide leaves 828 after the sidebar and margins; 720 tall leaves (720 - 152) * 16/9 = 1009 by height.
    expect(videoMaxWidth(1100, 720)).toBe(828)
    // A short window is limited by height instead.
    expect(videoMaxWidth(2000, 480)).toBe(Math.floor(((480 - 152) * 16) / 9))
    // A huge window is capped.
    expect(videoMaxWidth(4000, 3000)).toBe(900)
  })

  it('never goes below the minimum, even in a tiny window', () => {
    expect(videoMaxWidth(300, 200)).toBe(VIDEO_MIN_WIDTH)
  })

  it('clamps a width into the limits and rounds it', () => {
    expect(clampVideoWidth(500.4, 800)).toBe(500)
    expect(clampVideoWidth(10, 800)).toBe(VIDEO_MIN_WIDTH)
    expect(clampVideoWidth(5000, 800)).toBe(800)
  })

  it.each([NaN, Infinity, -Infinity])('uses the default for %s', (value) => {
    expect(clampVideoWidth(value, 800)).toBe(VIDEO_DEFAULT_WIDTH)
  })

  it('uses the largest size that fits when even the default is too big', () => {
    expect(clampVideoWidth(NaN, 380)).toBe(380)
  })
})

describe('remembering the size', () => {
  it('saves and reads back a width', () => {
    const storage = memory()
    saveVideoWidth(512.6, storage)
    expect(storage.setItem).toHaveBeenCalledWith('turntable.video-width', '513')
    expect(readSavedVideoWidth(storage)).toBe(513)
  })

  it.each([undefined, '', 'big', '-5', '4e2', '12.5', '12345', ' 400', '0x10'])('ignores a saved value of %j', (value) => {
    expect(readSavedVideoWidth(memory(value))).toBeUndefined()
  })

  it('copes with storage that is missing or refuses', () => {
    expect(readSavedVideoWidth(undefined)).toBeUndefined()
    const broken = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('full')
      }
    }
    expect(readSavedVideoWidth(broken)).toBeUndefined()
    expect(() => saveVideoWidth(400, broken)).not.toThrow()
    expect(() => saveVideoWidth(400, undefined)).not.toThrow()
  })
})
