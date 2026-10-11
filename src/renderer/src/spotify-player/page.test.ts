import { describe, expect, it, vi } from 'vitest'
import type { PlayerPageBridge, SpotifyPlayerCommand, SpotifyPlayerEvent } from '@shared/spotifyPlayer'
import { SPOTIFY_ERRORS } from '@shared/spotifyPlayer'
import { startPlayerPage, toStateEvent, type SdkState, type SpotifyNamespace } from './page'

class FakePlayer {
  listeners = new Map<string, (payload: unknown) => void>()
  connect = vi.fn().mockResolvedValue(true)
  disconnect = vi.fn()
  pause = vi.fn().mockResolvedValue(undefined)
  resume = vi.fn().mockResolvedValue(undefined)
  seek = vi.fn().mockResolvedValue(undefined)
  setVolume = vi.fn().mockResolvedValue(undefined)
  getCurrentState = vi.fn().mockResolvedValue(null)
  constructor(readonly options: { name: string; volume?: number; getOAuthToken: (cb: (token: string) => void) => void }) {}
  addListener(event: string, callback: (payload: never) => void): boolean {
    this.listeners.set(event, callback as (payload: unknown) => void)
    return true
  }
  fire(event: string, payload?: unknown): void {
    this.listeners.get(event)?.(payload)
  }
}

const state = (overrides: Partial<SdkState> = {}): SdkState => ({
  paused: false,
  position: 1500,
  duration: 200_000,
  track_window: { current_track: { id: 'track1' }, previous_tracks: [] },
  ...overrides
})

function setup() {
  let player!: FakePlayer
  // A constructor that returns an existing object makes `new` yield that object, so tests can reach the fake.
  const sdk = {
    Player: function (options: FakePlayer['options']) {
      player = new FakePlayer(options)
      return player
    }
  } as unknown as SpotifyNamespace
  const events: SpotifyPlayerEvent[] = []
  let command!: (c: SpotifyPlayerCommand) => void
  const bridge: PlayerPageBridge = {
    getToken: vi.fn().mockResolvedValue('access-token'),
    emit: (event) => events.push(event),
    onCommand: (listener) => void (command = listener)
  }
  const timers: { cb: () => void; ms: number; cleared: boolean }[] = []
  startPlayerPage(bridge, sdk, {
    setInterval: (cb, ms) => {
      const timer = { cb, ms, cleared: false }
      timers.push(timer)
      return timer
    },
    clearInterval: (handle) => void ((handle as { cleared: boolean }).cleared = true)
  })
  return { player, events, bridge, timers, send: (c: SpotifyPlayerCommand) => command(c) }
}

describe('startPlayerPage', () => {
  it('creates a player named TurnTable and connects it', () => {
    const { player } = setup()
    expect(player.options.name).toBe('TurnTable')
    expect(player.connect).toHaveBeenCalledOnce()
  })

  it('gives the SDK a fresh token from the bridge whenever it asks', async () => {
    const { player, bridge } = setup()
    const callback = vi.fn()
    player.options.getOAuthToken(callback)
    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith('access-token'))
    expect(bridge.getToken).toHaveBeenCalledOnce()
  })

  it('reports a permission error, and gives the SDK no token, when none can be provided', async () => {
    const { player, bridge, events } = setup()
    vi.mocked(bridge.getToken).mockRejectedValue(new Error('Reconnect Spotify to allow playback in TurnTable.'))
    const callback = vi.fn()

    player.options.getOAuthToken(callback)
    await vi.waitFor(() => expect(events).toHaveLength(1))

    expect(callback).not.toHaveBeenCalled()
    expect(events[0]).toEqual({ type: 'error', kind: 'permission', message: 'Reconnect Spotify to allow playback in TurnTable.' })
  })

  it('reports readiness and loss of the device', () => {
    const { player, events } = setup()
    player.fire('ready', { device_id: 'abc123' })
    player.fire('not_ready', { device_id: 'abc123' })
    expect(events).toEqual([{ type: 'ready', deviceId: 'abc123' }, { type: 'not-ready' }])
  })

  it.each([
    ['initialization_error', 'initialization', SPOTIFY_ERRORS.initialization],
    ['authentication_error', 'authentication', SPOTIFY_ERRORS.authentication],
    ['account_error', 'account', SPOTIFY_ERRORS.premium]
  ])('turns %s into a %s error with a message for the user', (sdkEvent, kind, message) => {
    const { player, events } = setup()
    player.fire(sdkEvent, { message: 'raw sdk text' })
    expect(events).toEqual([{ type: 'error', kind, message }])
  })

  it('includes the SDK message for playback errors', () => {
    const { player, events } = setup()
    player.fire('playback_error', { message: 'Cannot load track' })
    player.fire('playback_error', { message: '' })
    expect(events).toEqual([
      { type: 'error', kind: 'playback', message: 'Spotify could not play this track: Cannot load track' },
      { type: 'error', kind: 'playback', message: 'Spotify could not play this track.' }
    ])
  })

  describe('state', () => {
    it('reports position, duration and pause state', () => {
      const { player, events } = setup()
      player.fire('player_state_changed', state())
      expect(events).toEqual([{ type: 'state', trackId: 'track1', linkedFromId: null, paused: false, positionMs: 1500, durationMs: 200_000, ended: false }])
    })

    it('ignores the null state the SDK sends when playback moves elsewhere', () => {
      const { player, events } = setup()
      player.fire('player_state_changed', null)
      expect(events).toEqual([])
    })

    it('polls while playing so the position keeps moving, and stops when paused', async () => {
      const { player, events, timers } = setup()
      player.getCurrentState.mockResolvedValue(state({ position: 2000 }))

      player.fire('player_state_changed', state())
      expect(timers).toHaveLength(1)
      expect(timers[0]!.ms).toBe(500)

      timers[0]!.cb()
      await vi.waitFor(() => expect(events).toHaveLength(2))
      expect(events[1]).toMatchObject({ positionMs: 2000 })
      expect(timers).toHaveLength(1)

      player.fire('player_state_changed', state({ paused: true }))
      expect(timers[0]!.cleared).toBe(true)
    })

    it('starts only one poll timer however many state changes arrive', () => {
      const { player, timers } = setup()
      player.fire('player_state_changed', state())
      player.fire('player_state_changed', state({ position: 2500 }))
      expect(timers).toHaveLength(1)
    })

    it('keeps going if one poll fails', async () => {
      const { player, timers } = setup()
      player.fire('player_state_changed', state())
      player.getCurrentState.mockRejectedValue(new Error('boom'))
      expect(() => timers[0]!.cb()).not.toThrow()
      await Promise.resolve()
    })
  })

  describe('commands', () => {
    it('forwards pause, resume, seek and volume to the SDK', () => {
      const { player, send } = setup()
      send({ type: 'pause' })
      send({ type: 'resume' })
      send({ type: 'seek', positionMs: 12_345.6 })
      send({ type: 'setVolume', volume: 0.4 })

      expect(player.pause).toHaveBeenCalledOnce()
      expect(player.resume).toHaveBeenCalledOnce()
      expect(player.seek).toHaveBeenCalledWith(12_346)
      expect(player.setVolume).toHaveBeenCalledWith(0.4)
    })

    it('keeps seek and volume within valid ranges', () => {
      const { player, send } = setup()
      send({ type: 'seek', positionMs: -50 })
      send({ type: 'setVolume', volume: 3 })
      send({ type: 'setVolume', volume: -1 })

      expect(player.seek).toHaveBeenCalledWith(0)
      expect(player.setVolume).toHaveBeenNthCalledWith(1, 1)
      expect(player.setVolume).toHaveBeenNthCalledWith(2, 0)
    })
  })
})

describe('toStateEvent', () => {
  it('recognizes a track that just finished: paused at 0 with itself among the previous tracks', () => {
    const finished = state({ paused: true, position: 0, track_window: { current_track: { id: 'a' }, previous_tracks: [{ id: 'x' }, { id: 'a' }] } })
    expect(toStateEvent(finished)).toMatchObject({ ended: true, paused: true })
  })

  it.each([
    ['paused at 0 before ever playing', state({ paused: true, position: 0 })],
    ['paused part-way through', state({ paused: true, position: 4000, track_window: { current_track: { id: 'a' }, previous_tracks: [{ id: 'a' }] } })],
    ['playing', state({ track_window: { current_track: { id: 'a' }, previous_tracks: [{ id: 'a' }] } })],
    ['no current track', state({ paused: true, position: 0, track_window: { current_track: null, previous_tracks: [{ id: 'a' }] } })]
  ])('does not treat %s as the end of a track', (_label, input) => {
    expect(toStateEvent(input)).toMatchObject({ ended: false })
  })

  it('reports the requested id when Spotify plays a regional variant of the track', () => {
    const relinked = state({ track_window: { current_track: { id: 'variant', linked_from: { id: 'requested' } }, previous_tracks: [] } })
    expect(toStateEvent(relinked)).toMatchObject({ trackId: 'variant', linkedFromId: 'requested' })
  })

  it('falls back to the track duration when the state has none', () => {
    const input = state({ duration: undefined, track_window: { current_track: { id: 'a', duration_ms: 123_000 }, previous_tracks: [] } })
    expect(toStateEvent(input)).toMatchObject({ durationMs: 123_000 })
    expect(toStateEvent(state({ duration: undefined }))).toMatchObject({ durationMs: 0 })
  })
})
