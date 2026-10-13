import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TidalPlayerHost, type PlayerWindow } from '../src/main/tidalPlayer/host'
import { TIDAL_ERRORS, type TidalPlayerEvent } from '../src/shared/tidalPlayer'

function setup(loadResult: () => Promise<void> = () => Promise.resolve()) {
  const windows: (PlayerWindow & { destroyed: boolean })[] = []
  const emitted: TidalPlayerEvent[] = []
  const host = new TidalPlayerHost({
    createWindow: () => {
      const window = { destroyed: false, load: vi.fn(loadResult), send: vi.fn(), destroy: vi.fn(() => void (window.destroyed = true)) }
      windows.push(window)
      return window
    },
    emit: (event) => emitted.push(event),
    readyTimeoutMs: 1000
  })
  return { host, windows, emitted }
}

const tick = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('TidalPlayerHost', () => {
  it('starts the player on the first play, waits until it is ready, then tells it to load the track', async () => {
    const { host, windows } = setup()

    const playing = host.play('track1')
    await tick()
    expect(windows).toHaveLength(1)
    expect(windows[0]!.send).not.toHaveBeenCalled()

    host.handleEvent({ type: 'ready' })
    await playing
    expect(windows[0]!.send).toHaveBeenCalledExactlyOnceWith({ type: 'load', trackId: 'track1' })
  })

  it('reuses the player for the next track, and starts only one when plays overlap', async () => {
    const { host, windows } = setup()
    const first = host.play('a')
    const second = host.play('b')
    await tick()
    host.handleEvent({ type: 'ready' })
    await Promise.all([first, second])

    await host.play('c')

    expect(windows).toHaveLength(1)
    expect(vi.mocked(windows[0]!.send).mock.calls.map((call) => (call[0] as { trackId: string }).trackId)).toEqual(['a', 'b', 'c'])
  })

  it('passes commands on to the player, and drops them when there is none', async () => {
    const { host, windows } = setup()
    host.send({ type: 'pause' })
    const playing = host.play('a')
    await tick()
    host.handleEvent({ type: 'ready' })
    await playing

    host.send({ type: 'seek', positionMs: 5000 })

    expect(windows[0]!.send).toHaveBeenLastCalledWith({ type: 'seek', positionMs: 5000 })
    expect(windows[0]!.send).toHaveBeenCalledTimes(2)
  })

  it('relays every event the player reports to the app', async () => {
    const { host, emitted } = setup()
    const events: TidalPlayerEvent[] = [{ type: 'ready' }, { type: 'state', trackId: 'a', paused: false, positionMs: 1, durationMs: 2, ended: false }, { type: 'error', kind: 'playback', message: 'x' }]
    for (const event of events) host.handleEvent(event)
    expect(emitted).toEqual(events)
  })

  it.each([
    ['initialization', TIDAL_ERRORS.initialization],
    ['authentication', TIDAL_ERRORS.authentication],
    ['permission', 'Reconnect TIDAL to allow playback in Muze.']
  ] as const)('fails a pending play with the %s message and shuts the player down', async (kind, message) => {
    const { host, windows } = setup()
    const playing = host.play('a')
    const assertion = expect(playing).rejects.toThrow(message)

    host.handleEvent({ type: 'error', kind, message })

    await assertion
    expect(windows[0]!.destroyed).toBe(true)
  })

  it('keeps the player after an error about one track', async () => {
    const { host, windows } = setup()
    const playing = host.play('a')
    await tick()
    host.handleEvent({ type: 'ready' })
    await playing

    host.handleEvent({ type: 'error', kind: 'playback', message: 'This track failed' })

    expect(windows[0]!.destroyed).toBe(false)
  })

  it('can start a fresh player on the next play after a fatal error', async () => {
    const { host, windows } = setup()
    const failed = host.play('a')
    const assertion = expect(failed).rejects.toThrow()
    host.handleEvent({ type: 'error', kind: 'authentication', message: TIDAL_ERRORS.authentication })
    await assertion

    const retry = host.play('a')
    host.handleEvent({ type: 'ready' })
    await retry
    expect(windows).toHaveLength(2)
  })

  it('gives up with a message when the player never becomes ready', async () => {
    const { host, windows } = setup()
    const playing = host.play('a')
    const assertion = expect(playing).rejects.toThrow(TIDAL_ERRORS.notReady)
    await vi.advanceTimersByTimeAsync(1001)
    await assertion
    expect(windows[0]!.destroyed).toBe(true)
  })

  it('gives up with a message when the player page cannot be loaded', async () => {
    const { host, windows } = setup(() => Promise.reject(new Error('net::ERR')))
    const playing = host.play('a')
    const assertion = expect(playing).rejects.toThrow(TIDAL_ERRORS.loadFailed)
    await tick()
    await assertion
    expect(windows[0]!.destroyed).toBe(true)
  })
})
