// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useVideoSize } from './useVideoSize'
import { VIDEO_DEFAULT_WIDTH, VIDEO_MIN_WIDTH } from './videoSize'

const resizeWindow = (width: number, height: number): void => {
  Object.assign(window, { innerWidth: width, innerHeight: height })
  window.dispatchEvent(new Event('resize'))
}

beforeEach(() => {
  window.localStorage.clear()
  Object.assign(window, { innerWidth: 1200, innerHeight: 800 })
})
afterEach(() => window.localStorage.clear())

describe('useVideoSize', () => {
  it('starts at the default size', () => {
    const { result } = renderHook(() => useVideoSize())
    expect(result.current).toMatchObject({ width: VIDEO_DEFAULT_WIDTH, min: VIDEO_MIN_WIDTH })
  })

  it('sets and remembers a size, within the limits', () => {
    const { result } = renderHook(() => useVideoSize())

    act(() => result.current.set(600))
    expect(result.current.width).toBe(600)
    expect(window.localStorage.getItem('turntable.video-width')).toBe('600')

    act(() => result.current.set(50))
    expect(result.current.width).toBe(VIDEO_MIN_WIDTH)
    act(() => result.current.set(5000))
    expect(result.current.width).toBe(result.current.max)
  })

  it('starts from the size saved last time', () => {
    window.localStorage.setItem('turntable.video-width', '640')
    expect(renderHook(() => useVideoSize()).result.current.width).toBe(640)
  })

  it('ignores a damaged saved size', () => {
    window.localStorage.setItem('turntable.video-width', 'huge')
    expect(renderHook(() => useVideoSize()).result.current.width).toBe(VIDEO_DEFAULT_WIDTH)
  })

  it('resets to the default', () => {
    const { result } = renderHook(() => useVideoSize())
    act(() => result.current.set(700))
    act(() => result.current.reset())
    expect(result.current.width).toBe(VIDEO_DEFAULT_WIDTH)
  })

  it('squeezes to fit a smaller window, and springs back without forgetting the choice', () => {
    window.localStorage.setItem('turntable.video-width', '800')
    const { result } = renderHook(() => useVideoSize())
    expect(result.current.width).toBe(800)

    act(() => resizeWindow(900, 800))
    expect(result.current.max).toBe(900 - 272)
    expect(result.current.width).toBe(900 - 272)
    expect(window.localStorage.getItem('turntable.video-width')).toBe('800')

    act(() => resizeWindow(1200, 800))
    expect(result.current.width).toBe(800)
  })

  it('stops listening to the window when it goes away', () => {
    const { result, unmount } = renderHook(() => useVideoSize())
    unmount()
    act(() => resizeWindow(500, 500))
    expect(result.current.max).not.toBe(356)
  })

  it('keeps working when storage is blocked', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked')
      }
    })
    try {
      const { result } = renderHook(() => useVideoSize())
      act(() => result.current.set(500))
      expect(result.current.width).toBe(500)
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original)
    }
  })
})
