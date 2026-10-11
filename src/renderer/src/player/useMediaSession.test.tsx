// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '@shared/types'
import type { Player } from './usePlayer'
import { useMediaSession } from './useMediaSession'

const track: Track = { id: 'a'.repeat(24), providerId: 'local', title: 'Song', artists: ['Artist'], album: 'Album', durationMs: 1000 }

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
    ...overrides
  }
}

const handlers = new Map<string, MediaSessionActionHandler | null>()
const session = { metadata: null as unknown, playbackState: 'none', setActionHandler: (action: string, handler: MediaSessionActionHandler | null) => void handlers.set(action, handler) }

beforeEach(() => {
  handlers.clear()
  Object.defineProperty(navigator, 'mediaSession', { value: session, configurable: true })
  vi.stubGlobal('MediaMetadata', class { constructor(readonly init: unknown) {} })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  delete (navigator as { mediaSession?: unknown }).mediaSession
})

const call = (action: string, details: Partial<MediaSessionActionDetails> = {}): void => handlers.get(action)?.({ action: action as MediaSessionAction, ...details })

describe('useMediaSession', () => {
  it('lets the system skip forward and back, and play and pause', () => {
    const player = makePlayer()
    renderHook(() => useMediaSession(player))
    call('nexttrack')
    call('previoustrack')
    call('play')
    call('pause')
    call('stop')
    expect(player.next).toHaveBeenCalledOnce()
    expect(player.previous).toHaveBeenCalledOnce()
    expect(player.toggle).toHaveBeenCalledOnce()
    expect(player.pause).toHaveBeenCalledTimes(2)
  })

  it('does not offer skip forward when nothing follows, so the system can show it as unavailable', () => {
    renderHook(() => useMediaSession(makePlayer({ hasNext: false })))
    expect(handlers.get('nexttrack')).toBeNull()
    expect(handlers.get('previoustrack')).toBeTypeOf('function')
  })

  it('offers skip forward while shuffling, as the player says it has a next song', () => {
    renderHook(() => useMediaSession(makePlayer({ shuffle: true, hasNext: true })))
    expect(handlers.get('nexttrack')).toBeTypeOf('function')
  })

  it('offers no skipping before anything has played', () => {
    renderHook(() => useMediaSession(makePlayer({ track: undefined, hasNext: false })))
    expect(handlers.get('previoustrack')).toBeNull()
    expect(handlers.get('nexttrack')).toBeNull()
  })

  it('seeks to where the system asks', () => {
    const player = makePlayer()
    renderHook(() => useMediaSession(player))
    call('seekto', { seekTime: 42 })
    call('seekto', {})
    expect(player.seek).toHaveBeenCalledExactlyOnceWith(42)
  })

  it('shows what is playing, and whether it is playing', () => {
    const { rerender } = renderHook(({ p }) => useMediaSession(p), { initialProps: { p: makePlayer() } })
    expect(session.playbackState).toBe('playing')
    expect((session.metadata as { init: { title: string } }).init.title).toBe('Song')
    rerender({ p: makePlayer({ status: 'paused' }) })
    expect(session.playbackState).toBe('paused')
    rerender({ p: makePlayer({ track: undefined, status: 'idle' }) })
    expect(session.playbackState).toBe('none')
    expect(session.metadata).toBeNull()
  })

  it('lets go of the keys when it goes away', () => {
    const { unmount } = renderHook(() => useMediaSession(makePlayer()))
    unmount()
    for (const action of ['nexttrack', 'previoustrack', 'play', 'pause', 'stop', 'seekto']) expect(handlers.get(action)).toBeNull()
  })

  it('is fine where there is no media session', () => {
    delete (navigator as { mediaSession?: unknown }).mediaSession
    expect(() => renderHook(() => useMediaSession(makePlayer()))).not.toThrow()
  })
})
