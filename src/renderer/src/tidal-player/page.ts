import { describeError } from '@shared/errors'
import { TIDAL_ERRORS, type TidalPageBridge, type TidalPlayerCommand } from '@shared/tidalPlayer'

/** What TIDAL's player asks of whoever supplies its credentials (`CredentialsProvider` in `@tidal-music/common`). */
export interface SdkCredentialsProvider {
  bus: (subscriber: (event: unknown) => void) => void
  getCredentials: (apiErrorSubStatus?: string) => Promise<{ clientId: string; requestedScopes: string[]; token?: string }>
}

/** The slice of TIDAL's player SDK (`@tidal-music/player`) this page uses. */
export interface TidalSdk {
  setCredentialsProvider(provider: SdkCredentialsProvider): void
  /** Where the SDK sends the play reports TIDAL's own apps produce. It refuses to play until something is set. */
  setEventSender(sender: { sendEvent(event: unknown): void }): void
  setStreamingWifiAudioQuality(quality: 'LOW' | 'HIGH' | 'LOSSLESS' | 'HI_RES_LOSSLESS'): void
  load(product: { productId: string; productType: 'track'; sourceId: string; sourceType: string }, assetPosition?: number): Promise<void>
  play(): Promise<void>
  pause(): void | Promise<void>
  seek(seconds: number): Promise<unknown>
  setVolumeLevel(level: number): void
  getAssetPosition(): number
  events: EventTarget
}

export interface PageOptions {
  pollMs?: number
  setInterval?: (callback: () => void, ms: number) => unknown
  clearInterval?: (handle: unknown) => void
}

/** What the SDK's events carry (`CustomEvent.detail`); read defensively, since it is TIDAL's code that sends them. */
const detailOf = (event: Event): Record<string, unknown> => {
  const detail = (event as CustomEvent<unknown>).detail
  return typeof detail === 'object' && detail !== null ? (detail as Record<string, unknown>) : {}
}

/** The scopes TIDAL's player is asked to work with. */
const REQUESTED_SCOPES = ['playback']

/** Runs inside the hidden player page: sets up TIDAL's player, reports its events, and obeys commands. */
export function startTidalPage(bridge: TidalPageBridge, sdk: TidalSdk, options: PageOptions = {}): void {
  const { pollMs = 500, setInterval: startTimer = (cb, ms) => window.setInterval(cb, ms), clearInterval: stopTimer = (h) => window.clearInterval(h as number) } = options

  let trackId: string | null = null
  let state = 'IDLE'
  let durationMs = 0
  let timer: unknown

  const playing = (): boolean => state === 'PLAYING' || state === 'STALLED'

  const report = (ended = false): void => {
    bridge.emit({
      type: 'state',
      trackId,
      paused: !playing(),
      positionMs: ended ? 0 : Math.max(0, Math.round(sdk.getAssetPosition() * 1000)),
      durationMs,
      ended
    })
  }

  // The SDK only reports changes, so poll while playing to keep the position moving.
  const syncTimer = (): void => {
    if (playing() && timer === undefined) timer = startTimer(() => report(), pollMs)
    else if (!playing() && timer !== undefined) {
      stopTimer(timer)
      timer = undefined
    }
  }

  const fail = (message: string, kind: 'playback' | 'authentication' | 'permission' = 'playback'): void => bridge.emit({ type: 'error', kind, message })

  try {
    sdk.setCredentialsProvider({
      // Credentials only change when we hand out new ones, which is every time they are asked for.
      bus: () => undefined,
      getCredentials: async () => {
        try {
          const { clientId, token } = await bridge.getAuth()
          return { clientId, token, requestedScopes: REQUESTED_SCOPES }
        } catch (error) {
          fail(describeError(error), 'permission')
          throw error
        }
      }
    })
    // The SDK will not play without an event sender. TIDAL's real one (`@tidal-music/event-producer`) is for TIDAL's
    // own apps and needs TIDAL's internal endpoints, so this takes the events and sends them nowhere, as the SDK's own
    // demo does. That means TIDAL gets no play reports from Muze: see the README before releasing it.
    sdk.setEventSender({ sendEvent: () => undefined })
    // Muze exists for high fidelity, so ask for the best TIDAL will give this account.
    sdk.setStreamingWifiAudioQuality('HI_RES_LOSSLESS')
  } catch {
    bridge.emit({ type: 'error', kind: 'initialization', message: TIDAL_ERRORS.initialization })
    return
  }

  sdk.events.addEventListener('playback-state-change', (event) => {
    const next = detailOf(event).state
    if (typeof next !== 'string') return
    state = next
    syncTimer()
    report()
  })

  sdk.events.addEventListener('media-product-transition', (event) => {
    const duration = detailOf(event).playbackContext
    const seconds = typeof duration === 'object' && duration !== null ? (duration as { actualDuration?: unknown }).actualDuration : undefined
    if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) durationMs = Math.round(seconds * 1000)
    report()
  })

  sdk.events.addEventListener('ended', (event) => {
    const reason = detailOf(event).reason
    if (reason === 'completed') {
      state = 'NOT_PLAYING'
      syncTimer()
      report(true)
    } else if (reason === 'error') {
      fail(TIDAL_ERRORS.playback)
    }
    // A track ended because another was loaded ('skip') is not news.
  })

  sdk.events.addEventListener('error', (event) => {
    const { errorCode } = detailOf(event)
    fail(typeof errorCode === 'string' ? `${TIDAL_ERRORS.playback} (${errorCode})` : TIDAL_ERRORS.playback)
  })

  sdk.events.addEventListener('streaming-privileges-revoked', () => fail(TIDAL_ERRORS.otherDevice))

  const run = async (command: TidalPlayerCommand): Promise<void> => {
    switch (command.type) {
      case 'load':
        trackId = command.trackId
        state = 'NOT_PLAYING'
        durationMs = 0
        syncTimer()
        await sdk.load({ productId: command.trackId, productType: 'track', sourceType: 'MUZE', sourceId: 'muze' }, 0)
        await sdk.play()
        return
      case 'pause':
        await sdk.pause()
        return
      case 'resume':
        await sdk.play()
        return
      case 'seek':
        await sdk.seek(Math.max(0, command.positionMs / 1000))
        report()
        return
      case 'setVolume':
        sdk.setVolumeLevel(Math.round(Math.min(1, Math.max(0, command.volume)) * 100))
        return
    }
  }

  bridge.onCommand((command) => {
    run(command).catch((error: unknown) => fail(`${TIDAL_ERRORS.playback} ${describeError(error)}`.trim()))
  })

  bridge.emit({ type: 'ready' })
}
