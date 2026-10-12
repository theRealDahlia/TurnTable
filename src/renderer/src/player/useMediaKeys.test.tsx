// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SpotifyPlayerApi, SpotifyPlayerEvent } from '@shared/spotifyPlayer'
import type { Track } from '@shared/types'
import type { Player } from './usePlayer'
import { useMediaKeys } from './useMediaKeys'

const track: Track = { id: 'a'.repeat(24), providerId: 'local', title: 'Song', artists: [], durationMs: 1000 }

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    track,
    status: 'playing',
    currentTime: 0,
    duration: 100,
    volume: 1,
    hasNext: true,
    hasPrevious: true,
    shuffle: false,
    play: vi.fn(),
    toggle: vi.fn(),
    pause: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    setShuffle: vi.fn(),
    clear: vi.fn(),
    ...overrides
  }
}

const press = (key: string, init: KeyboardEventInit = {}): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { key, cancelable: true, bubbles: true, ...init })
  act(() => void window.dispatchEvent(event))
  return event
}

let listener: ((event: SpotifyPlayerEvent) => void) | undefined
let unsubscribe: ReturnType<typeof vi.fn>

beforeEach(() => {
  listener = undefined
  unsubscribe = vi.fn()
  const spotify: SpotifyPlayerApi = {
    play: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    onEvent: (cb) => {
      listener = cb
      return unsubscribe as () => void
    }
  }
  Object.assign(window, { turntableSpotify: spotify })
})
afterEach(() => {
  cleanup()
  delete (window as { turntableSpotify?: unknown }).turntableSpotify
})

describe('useMediaKeys F7 and F9', () => {
  it('F7 does what the Previous button does', () => {
    const player = makePlayer()
    renderHook(() => useMediaKeys(player))
    const event = press('F7')
    expect(player.previous).toHaveBeenCalledOnce()
    expect(player.next).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  it('F9 does what the Next button does', () => {
    const player = makePlayer()
    renderHook(() => useMediaKeys(player))
    const event = press('F9')
    expect(player.next).toHaveBeenCalledOnce()
    expect(player.previous).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(true)
  })

  it('F9 does nothing where the Next button is greyed out, and F7 always has the Previous button', () => {
    const player = makePlayer({ hasNext: false, hasPrevious: false })
    renderHook(() => useMediaKeys(player))
    press('F9')
    expect(player.next).not.toHaveBeenCalled()
    press('F7')
    expect(player.previous).toHaveBeenCalledOnce()
  })

  it('does nothing before anything has been played, when there is no player bar to click', () => {
    const player = makePlayer({ track: undefined, hasNext: false, hasPrevious: false })
    renderHook(() => useMediaKeys(player))
    press('F7')
    press('F9')
    expect(player.previous).not.toHaveBeenCalled()
    expect(player.next).not.toHaveBeenCalled()
  })

  it('counts a held key as one press, so holding F9 does not skip through the whole queue', () => {
    const player = makePlayer()
    renderHook(() => useMediaKeys(player))
    press('F9')
    press('F9', { repeat: true })
    press('F9', { repeat: true })
    expect(player.next).toHaveBeenCalledOnce()
  })

  it.each([
    ['Cmd', { metaKey: true }],
    ['Ctrl', { ctrlKey: true }],
    ['Option', { altKey: true }],
    ['Shift', { shiftKey: true }]
  ])('leaves %s+F7 and %s+F9 to whatever else uses them', (_name, modifier) => {
    const player = makePlayer()
    renderHook(() => useMediaKeys(player))
    expect(press('F7', modifier).defaultPrevented).toBe(false)
    expect(press('F9', modifier).defaultPrevented).toBe(false)
    expect(player.previous).not.toHaveBeenCalled()
    expect(player.next).not.toHaveBeenCalled()
  })

  it('leaves the neighbouring function keys alone', () => {
    const player = makePlayer()
    renderHook(() => useMediaKeys(player))
    for (const key of ['F6', 'F8', 'F10', 'F1']) expect(press(key).defaultPrevented).toBe(false)
    expect(player.toggle).not.toHaveBeenCalled()
    expect(player.next).not.toHaveBeenCalled()
    expect(player.previous).not.toHaveBeenCalled()
  })

  it('works with shuffle on, because it is the same Next and Previous', () => {
    const player = makePlayer({ shuffle: true })
    renderHook(() => useMediaKeys(player))
    press('F9')
    press('F7')
    expect(player.next).toHaveBeenCalledOnce()
    expect(player.previous).toHaveBeenCalledOnce()
  })

  it('works while typing in a search box, since these keys type nothing', () => {
    const player = makePlayer()
    renderHook(() => useMediaKeys(player))
    const input = document.body.appendChild(document.createElement('input'))
    input.focus()
    act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9', bubbles: true, cancelable: true })))
    expect(player.next).toHaveBeenCalledOnce()
    input.remove()
  })
})

describe('useMediaKeys keyboard keys', () => {
  it('skips forward with the next-track key', () => {
    const player = makePlayer()
    renderHook(() => useMediaKeys(player))
    const event = press('MediaTrackNext')
    expect(player.next).toHaveBeenCalledOnce()
    expect(event.defaultPrevented).toBe(true)
  })

  it('skips back with the previous-track key', () => {
    const player = makePlayer()
    renderHook(() => useMediaKeys(player))
    press('MediaTrackPrevious')
    expect(player.previous).toHaveBeenCalledOnce()
  })

  it('plays and pauses with the play/pause key', () => {
    const player = makePlayer()
    renderHook(() => useMediaKeys(player))
    press('MediaPlayPause')
    expect(player.toggle).toHaveBeenCalledOnce()
  })

  it('pauses with the stop key', () => {
    const player = makePlayer()
    renderHook(() => useMediaKeys(player))
    press('MediaStop')
    expect(player.pause).toHaveBeenCalledOnce()
  })

  it('does not skip forward when there is nothing after this song', () => {
    const player = makePlayer({ hasNext: false })
    renderHook(() => useMediaKeys(player))
    press('MediaTrackNext')
    expect(player.next).not.toHaveBeenCalled()
  })

  it('skips with the same keys while shuffling, because the player decides what comes next', () => {
    const player = makePlayer({ shuffle: true })
    renderHook(() => useMediaKeys(player))
    press('MediaTrackNext')
    press('MediaTrackPrevious')
    expect(player.next).toHaveBeenCalledOnce()
    expect(player.previous).toHaveBeenCalledOnce()
  })

  it('does nothing when nothing has been played', () => {
    const player = makePlayer({ track: undefined, hasNext: false, hasPrevious: false })
    renderHook(() => useMediaKeys(player))
    for (const key of ['MediaTrackNext', 'MediaTrackPrevious', 'MediaPlayPause']) press(key)
    expect(player.next).not.toHaveBeenCalled()
    expect(player.previous).not.toHaveBeenCalled()
    expect(player.toggle).not.toHaveBeenCalled()
  })

  it('counts a held key as one press', () => {
    const player = makePlayer()
    renderHook(() => useMediaKeys(player))
    press('MediaTrackNext')
    press('MediaTrackNext', { repeat: true })
    press('MediaTrackNext', { repeat: true })
    expect(player.next).toHaveBeenCalledOnce()
  })

  it('leaves every other key alone', () => {
    const player = makePlayer()
    renderHook(() => useMediaKeys(player))
    for (const key of ['ArrowRight', 'ArrowLeft', ' ', 'n', 'MediaFastForward']) expect(press(key).defaultPrevented).toBe(false)
    expect(player.next).not.toHaveBeenCalled()
    expect(player.previous).not.toHaveBeenCalled()
    expect(player.toggle).not.toHaveBeenCalled()
  })

  it('works whichever page has focus, even in a text field', () => {
    const player = makePlayer()
    renderHook(() => useMediaKeys(player))
    const input = document.body.appendChild(document.createElement('input'))
    input.focus()
    act(() => void input.dispatchEvent(new KeyboardEvent('keydown', { key: 'MediaTrackNext', bubbles: true, cancelable: true })))
    expect(player.next).toHaveBeenCalledOnce()
    input.remove()
  })

  it('uses the player as it is now, not as it was', () => {
    const first = makePlayer({ hasNext: false })
    const { rerender } = renderHook(({ player }) => useMediaKeys(player), { initialProps: { player: first } })
    press('MediaTrackNext')
    expect(first.next).not.toHaveBeenCalled()

    const second = makePlayer({ hasNext: true })
    rerender({ player: second })
    press('MediaTrackNext')
    expect(second.next).toHaveBeenCalledOnce()
    expect(first.next).not.toHaveBeenCalled()
  })

  it('stops listening when it goes away', () => {
    const player = makePlayer()
    const { unmount } = renderHook(() => useMediaKeys(player))
    unmount()
    press('MediaTrackNext')
    expect(player.next).not.toHaveBeenCalled()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})

describe('useMediaKeys keys that reach Spotify', () => {
  it.each([
    ['next', 'next'],
    ['previous', 'previous'],
    ['toggle', 'toggle']
  ] as const)('does what a "%s" key from the Spotify player asks', (action, method) => {
    const player = makePlayer()
    renderHook(() => useMediaKeys(player))
    act(() => listener!({ type: 'media-key', action }))
    expect(player[method]).toHaveBeenCalledOnce()
  })

  it('ignores Spotify\'s other events', () => {
    const player = makePlayer()
    renderHook(() => useMediaKeys(player))
    act(() => listener!({ type: 'not-ready' }))
    act(() => listener!({ type: 'state', trackId: 'x', paused: false, positionMs: 0, durationMs: 1, ended: false }))
    expect(player.next).not.toHaveBeenCalled()
    expect(player.toggle).not.toHaveBeenCalled()
  })

  it('does not skip forward at the end of the queue, or when nothing is loaded', () => {
    const atEnd = makePlayer({ hasNext: false })
    renderHook(() => useMediaKeys(atEnd))
    act(() => listener!({ type: 'media-key', action: 'next' }))
    expect(atEnd.next).not.toHaveBeenCalled()

    cleanup()
    const idle = makePlayer({ track: undefined })
    renderHook(() => useMediaKeys(idle))
    act(() => listener!({ type: 'media-key', action: 'toggle' }))
    expect(idle.toggle).not.toHaveBeenCalled()
  })

  it('works where there is no Spotify bridge, as in a plain browser', () => {
    delete (window as { turntableSpotify?: unknown }).turntableSpotify
    const player = makePlayer()
    expect(() => renderHook(() => useMediaKeys(player))).not.toThrow()
    press('MediaTrackNext')
    expect(player.next).toHaveBeenCalledOnce()
  })
})
