import { describe, expect, it, vi } from 'vitest'
import type { TidalPageBridge, TidalPlayerCommand, TidalPlayerEvent } from '@shared/tidalPlayer'
import { TIDAL_ERRORS } from '@shared/tidalPlayer'
import { startTidalPage, type SdkCredentialsProvider, type TidalSdk } from './page'

function setup(options: { auth?: () => Promise<{ clientId: string; token: string }>; sdkOverrides?: Partial<TidalSdk> } = {}) {
  const events: TidalPlayerEvent[] = []
  let command: ((c: TidalPlayerCommand) => void) | undefined
  const bridge: TidalPageBridge = {
    getAuth: options.auth ?? (async () => ({ clientId: 'client-1', token: 'token-1' })),
    emit: (event) => events.push(event),
    onCommand: (listener) => void (command = listener)
  }
  let provider: SdkCredentialsProvider | undefined
  let position = 0
  const target = new EventTarget()
  const sdk: TidalSdk = {
    setCredentialsProvider: vi.fn((p: SdkCredentialsProvider) => void (provider = p)),
    setStreamingWifiAudioQuality: vi.fn(),
    load: vi.fn().mockResolvedValue(undefined),
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn(),
    seek: vi.fn().mockResolvedValue(undefined),
    setVolumeLevel: vi.fn(),
    getAssetPosition: () => position,
    events: target,
    ...options.sdkOverrides
  }
  let tick: (() => void) | undefined
  let stopped = 0
  startTidalPage(bridge, sdk, { setInterval: (cb) => ((tick = cb), 1), clearInterval: () => void stopped++ })
  const fire = (name: string, detail?: unknown): void => void target.dispatchEvent(new CustomEvent(name, { detail }))
  return {
    events,
    sdk,
    send: (c: TidalPlayerCommand) => command?.(c),
    fire,
    credentials: () => provider!.getCredentials(),
    setPosition: (seconds: number) => void (position = seconds),
    tick: () => tick?.(),
    stopped: () => stopped
  }
}

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('TIDAL player page', () => {
  it('sets up the SDK with credentials from the app, asks for the best quality, and says it is ready', async () => {
    const t = setup()

    expect(t.sdk.setStreamingWifiAudioQuality).toHaveBeenCalledWith('HI_RES_LOSSLESS')
    expect(t.events).toEqual([{ type: 'ready' }])
    expect(await t.credentials()).toEqual({ clientId: 'client-1', token: 'token-1', requestedScopes: ['playback'] })
  })

  it('gets a fresh token every time the SDK asks, and tells the app when it cannot have one', async () => {
    const auth = vi.fn().mockResolvedValueOnce({ clientId: 'c', token: 'a' }).mockResolvedValueOnce({ clientId: 'c', token: 'b' }).mockRejectedValueOnce(new Error('Reconnect TIDAL to allow playback in Muze.'))
    const t = setup({ auth })

    expect((await t.credentials()).token).toBe('a')
    expect((await t.credentials()).token).toBe('b')
    await expect(t.credentials()).rejects.toThrow('Reconnect TIDAL')
    expect(t.events.at(-1)).toEqual({ type: 'error', kind: 'permission', message: 'Reconnect TIDAL to allow playback in Muze.' })
  })

  it('reports an initialization error, and no readiness, when the SDK cannot be set up', () => {
    const t = setup({
      sdkOverrides: {
        setCredentialsProvider: () => {
          throw new Error('boom')
        }
      }
    })
    expect(t.events).toEqual([{ type: 'error', kind: 'initialization', message: TIDAL_ERRORS.initialization }])
  })

  it('loads a track by its id as a track product, then plays it, from the start', async () => {
    const t = setup()
    t.send({ type: 'load', trackId: 'abc123' })
    await flush()

    expect(t.sdk.load).toHaveBeenCalledExactlyOnceWith({ productId: 'abc123', productType: 'track', sourceType: 'MUZE', sourceId: 'muze' }, 0)
    expect(t.sdk.play).toHaveBeenCalledOnce()
    expect(vi.mocked(t.sdk.load).mock.invocationCallOrder[0]!).toBeLessThan(vi.mocked(t.sdk.play).mock.invocationCallOrder[0]!)
  })

  it("reports the track, whether it is playing, and its position in milliseconds, as the player's state changes", async () => {
    const t = setup()
    t.send({ type: 'load', trackId: 't1' })
    await flush()
    t.fire('media-product-transition', { mediaProduct: { productId: 't1' }, playbackContext: { actualDuration: 215.5 } })
    t.setPosition(12.3456)
    t.fire('playback-state-change', { state: 'PLAYING' })

    expect(t.events.at(-1)).toEqual({ type: 'state', trackId: 't1', paused: false, positionMs: 12346, durationMs: 215_500, ended: false })

    t.fire('playback-state-change', { state: 'NOT_PLAYING' })
    expect(t.events.at(-1)).toMatchObject({ paused: true })
    t.fire('playback-state-change', { state: 'STALLED' })
    expect(t.events.at(-1)).toMatchObject({ paused: false })
  })

  it('keeps the position moving while playing, and stops when it is not', async () => {
    const t = setup()
    t.send({ type: 'load', trackId: 't1' })
    t.fire('playback-state-change', { state: 'PLAYING' })
    t.setPosition(3)
    t.tick()
    expect(t.events.at(-1)).toMatchObject({ positionMs: 3000, paused: false })

    t.fire('playback-state-change', { state: 'NOT_PLAYING' })
    expect(t.stopped()).toBe(1)
  })

  it('says a track ended when it finished by itself, at position 0, and not when it was skipped', () => {
    const t = setup()
    t.send({ type: 'load', trackId: 't1' })
    t.fire('playback-state-change', { state: 'PLAYING' })
    const count = t.events.length

    t.fire('ended', { mediaProduct: { productId: 't1' }, reason: 'skip' })
    expect(t.events).toHaveLength(count)

    t.fire('ended', { mediaProduct: { productId: 't1' }, reason: 'completed' })
    expect(t.events.at(-1)).toEqual({ type: 'state', trackId: 't1', paused: true, positionMs: 0, durationMs: 0, ended: true })
  })

  it('reports errors from the player, with its code, and an ending caused by an error', () => {
    const t = setup()
    t.fire('error', { errorCode: 'S7001', errorId: 'EUnexpected' })
    expect(t.events.at(-1)).toEqual({ type: 'error', kind: 'playback', message: `${TIDAL_ERRORS.playback} (S7001)` })

    t.fire('error', {})
    expect(t.events.at(-1)).toEqual({ type: 'error', kind: 'playback', message: TIDAL_ERRORS.playback })

    t.fire('ended', { reason: 'error' })
    expect(t.events.at(-1)).toMatchObject({ type: 'error' })
  })

  it('says so when TIDAL ends playback here because the account started playing elsewhere', () => {
    const t = setup()
    t.fire('streaming-privileges-revoked', 'iPhone')
    expect(t.events.at(-1)).toEqual({ type: 'error', kind: 'playback', message: TIDAL_ERRORS.otherDevice })
  })

  it('obeys pause, resume, seek (in seconds) and volume (0 to 100)', async () => {
    const t = setup()
    t.send({ type: 'pause' })
    t.send({ type: 'resume' })
    t.send({ type: 'seek', positionMs: 65_500 })
    t.send({ type: 'seek', positionMs: -4 })
    t.send({ type: 'setVolume', volume: 0.5 })
    t.send({ type: 'setVolume', volume: 7 })
    t.send({ type: 'setVolume', volume: -1 })
    await flush()

    expect(t.sdk.pause).toHaveBeenCalledOnce()
    expect(t.sdk.play).toHaveBeenCalledOnce()
    expect(vi.mocked(t.sdk.seek).mock.calls.map((c) => c[0])).toEqual([65.5, 0])
    expect(vi.mocked(t.sdk.setVolumeLevel).mock.calls.map((c) => c[0])).toEqual([50, 100, 0])
  })

  it('reports a track that fails to load, with what the SDK said', async () => {
    const t = setup({ sdkOverrides: { load: vi.fn().mockRejectedValue(new Error('No manifest')) } })
    t.send({ type: 'load', trackId: 't1' })
    await flush()
    expect(t.events.at(-1)).toEqual({ type: 'error', kind: 'playback', message: `${TIDAL_ERRORS.playback} No manifest` })
    expect(t.sdk.play).not.toHaveBeenCalled()
  })

  it('ignores events whose details are not what the SDK documents', () => {
    const t = setup()
    const count = t.events.length
    t.fire('playback-state-change', 'PLAYING')
    t.fire('playback-state-change', { state: 7 })
    t.fire('media-product-transition', { playbackContext: { actualDuration: 'long' } })
    expect(t.events.slice(count).every((e) => e.type === 'state')).toBe(true)
    expect(t.events.slice(count)).toHaveLength(1)
  })
})
