import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpotifyPlayerHost, type PlayerWindow } from '../src/main/spotifyPlayer/host'
import { SPOTIFY_ERRORS, type SpotifyPlayerEvent } from '../src/shared/spotifyPlayer'

function setup(loadResult: () => Promise<void> = () => Promise.resolve()) {
  const windows: (PlayerWindow & { destroyed: boolean })[] = []
  const emitted: SpotifyPlayerEvent[] = []
  const startPlayback = vi.fn().mockResolvedValue(undefined)
  const host = new SpotifyPlayerHost({
    createWindow: () => {
      const window = { destroyed: false, load: vi.fn(loadResult), send: vi.fn(), destroy: vi.fn(() => void (window.destroyed = true)) }
      windows.push(window)
      return window
    },
    startPlayback,
    emit: (event) => emitted.push(event),
    readyTimeoutMs: 1000
  })
  return { host, windows, emitted, startPlayback }
}

const tick = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('SpotifyPlayerHost', () => {
  it('starts the player on the first play, waits until it is ready, then starts the track on its device', async () => {
    const { host, windows, startPlayback } = setup()

    const playing = host.play('track1')
    await tick()
    expect(windows).toHaveLength(1)
    expect(startPlayback).not.toHaveBeenCalled()

    host.handleEvent({ type: 'ready', deviceId: 'device-1' })
    await playing
    expect(startPlayback).toHaveBeenCalledExactlyOnceWith('device-1', 'track1')
  })

  it('reuses the running player for later plays', async () => {
    const { host, windows, startPlayback } = setup()
    const first = host.play('a')
    host.handleEvent({ type: 'ready', deviceId: 'device-1' })
    await first

    await host.play('b')

    expect(windows).toHaveLength(1)
    expect(startPlayback).toHaveBeenLastCalledWith('device-1', 'b')
  })

  it('starts only one player when plays arrive while it is still starting', async () => {
    const { host, windows, startPlayback } = setup()
    const plays = [host.play('a'), host.play('b')]
    host.handleEvent({ type: 'ready', deviceId: 'device-1' })
    await Promise.all(plays)

    expect(windows).toHaveLength(1)
    expect(startPlayback).toHaveBeenCalledTimes(2)
  })

  it('waits for the player to come back after it reports not-ready, without opening another window', async () => {
    const { host, windows, startPlayback } = setup()
    const first = host.play('a')
    host.handleEvent({ type: 'ready', deviceId: 'old' })
    await first

    host.handleEvent({ type: 'not-ready' })
    const again = host.play('b')
    await tick()
    expect(startPlayback).toHaveBeenCalledTimes(1)

    host.handleEvent({ type: 'ready', deviceId: 'new' })
    await again
    expect(startPlayback).toHaveBeenLastCalledWith('new', 'b')
    expect(windows).toHaveLength(1)
  })

  it.each([
    ['account', SPOTIFY_ERRORS.premium],
    ['initialization', SPOTIFY_ERRORS.initialization],
    ['authentication', SPOTIFY_ERRORS.authentication],
    ['permission', 'Reconnect Spotify to allow playback in Muze.']
  ] as const)('fails a pending play with the %s message and shuts the player down', async (kind, message) => {
    const { host, windows, startPlayback } = setup()
    const playing = host.play('a')
    const assertion = expect(playing).rejects.toThrow(message)

    host.handleEvent({ type: 'error', kind, message })

    await assertion
    expect(startPlayback).not.toHaveBeenCalled()
    expect(windows[0]!.destroyed).toBe(true)
  })

  it('can start a fresh player on the next play after a fatal error', async () => {
    const { host, windows } = setup()
    const failed = host.play('a')
    const assertion = expect(failed).rejects.toThrow()
    host.handleEvent({ type: 'error', kind: 'authentication', message: SPOTIFY_ERRORS.authentication })
    await assertion

    const retry = host.play('a')
    host.handleEvent({ type: 'ready', deviceId: 'device-2' })
    await retry
    expect(windows).toHaveLength(2)
  })

  it('keeps the player running through a playback error on one track', async () => {
    const { host, windows, emitted } = setup()
    const first = host.play('a')
    host.handleEvent({ type: 'ready', deviceId: 'device-1' })
    await first

    host.handleEvent({ type: 'error', kind: 'playback', message: 'Cannot load track' })

    expect(windows[0]!.destroyed).toBe(false)
    expect(emitted.at(-1)).toMatchObject({ type: 'error', kind: 'playback' })
  })

  it('gives up and cleans up if the player never becomes ready', async () => {
    const { host, windows } = setup()
    const playing = host.play('a')
    const assertion = expect(playing).rejects.toThrow(SPOTIFY_ERRORS.notReady)

    await vi.advanceTimersByTimeAsync(1001)

    await assertion
    expect(windows[0]!.destroyed).toBe(true)
  })

  it('does not time out once the player is ready', async () => {
    const { host, windows } = setup()
    const playing = host.play('a')
    host.handleEvent({ type: 'ready', deviceId: 'device-1' })
    await playing

    await vi.advanceTimersByTimeAsync(5000)
    expect(windows[0]!.destroyed).toBe(false)
  })

  it('reports a player page that fails to load', async () => {
    const { host, windows } = setup(() => Promise.reject(new Error('ERR_FAILED')))
    await expect(host.play('a')).rejects.toThrow(SPOTIFY_ERRORS.loadFailed)
    expect(windows[0]!.destroyed).toBe(true)
  })

  it('passes the playback failure through when starting the track is rejected', async () => {
    const { host, startPlayback } = setup()
    startPlayback.mockRejectedValue(new Error('Spotify: Premium required (status 403)'))
    const playing = host.play('a')
    host.handleEvent({ type: 'ready', deviceId: 'device-1' })
    await expect(playing).rejects.toThrow('Premium required')
  })

  it('relays every event to the app, and commands to the player', async () => {
    const { host, windows, emitted } = setup()
    const playing = host.play('a')
    const state = { type: 'state', trackId: 'a', paused: false, positionMs: 5, durationMs: 100, ended: false } as const
    host.handleEvent({ type: 'ready', deviceId: 'device-1' })
    host.handleEvent(state)
    await playing

    host.send({ type: 'pause' })
    host.send({ type: 'seek', positionMs: 1000 })

    expect(emitted).toContainEqual(state)
    expect(windows[0]!.send).toHaveBeenCalledWith({ type: 'pause' })
    expect(windows[0]!.send).toHaveBeenCalledWith({ type: 'seek', positionMs: 1000 })
  })

  it('passes media-key presses on to the app without disturbing the player', async () => {
    const { host, emitted } = setup()
    const playing = host.play('a')
    host.handleEvent({ type: 'ready', deviceId: 'device-1' })
    await playing

    host.handleEvent({ type: 'media-key', action: 'next' })

    expect(emitted).toContainEqual({ type: 'media-key', action: 'next' })
    await host.play('b')
  })

  it('ignores commands when no player is running', () => {
    const { host, windows } = setup()
    expect(() => host.send({ type: 'pause' })).not.toThrow()
    expect(windows).toHaveLength(0)
  })

  it('dispose() stops the player', async () => {
    const { host, windows } = setup()
    const playing = host.play('a')
    host.handleEvent({ type: 'ready', deviceId: 'device-1' })
    await playing

    host.dispose()
    expect(windows[0]!.destroyed).toBe(true)
  })
})
