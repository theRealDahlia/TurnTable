import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const exposed: Record<string, unknown> = {}
const invoke = vi.fn()
const send = vi.fn()
const on = vi.fn()
const removeListener = vi.fn()

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: (name: string, api: unknown) => void (exposed[name] = api) },
  ipcRenderer: { invoke: (...args: unknown[]) => invoke(...args), send: (...args: unknown[]) => send(...args), on: (...args: unknown[]) => on(...args), removeListener: (...args: unknown[]) => removeListener(...args) }
}))

/** Runs the real preload entry as if it had been loaded into a page at `pathname`. */
async function loadPreloadFor(pathname: string): Promise<void> {
  vi.resetModules()
  vi.stubGlobal('location', { pathname })
  await import('../src/preload/index')
}

beforeEach(() => {
  for (const key of Object.keys(exposed)) delete exposed[key]
  invoke.mockReset()
  send.mockReset()
  on.mockReset()
  removeListener.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

describe('preload role separation', () => {
  it('gives the app window the library API, Spotify controls and the YouTube page lookup, and nothing from the player page', async () => {
    await loadPreloadFor('/app/out/renderer/index.html')
    expect(Object.keys(exposed).sort()).toEqual(['turntable', 'turntableQobuz', 'turntableSoundCloud', 'turntableSpotify', 'turntableYouTube'])
    expect(Object.keys(exposed.turntable as object).sort()).toEqual(['connectProvider', 'disconnectProvider', 'getSavedTracks', 'listProviders', 'saveTrack', 'searchTracks', 'unsaveTrack'])
    expect(Object.keys(exposed.turntableSpotify as object).sort()).toEqual(['onEvent', 'pause', 'play', 'resume', 'seek', 'setVolume'])
    expect(Object.keys(exposed.turntableYouTube as object)).toEqual(['getPlayerUrl'])
    expect(Object.keys(exposed.turntableSoundCloud as object)).toEqual(['getPlayerUrl'])
    expect(Object.keys(exposed.turntableQobuz as object)).toEqual(['getStreamUrl'])
  })

  it('gives the hidden Spotify page only its narrow bridge: no library, no connections, no controls', async () => {
    await loadPreloadFor('/app/out/renderer/spotify-player.html')
    expect(Object.keys(exposed)).toEqual(['turntableSpotifyPage'])
    expect(Object.keys(exposed.turntableSpotifyPage as object).sort()).toEqual(['emit', 'getToken', 'onCommand'])
  })

  it('falls back to the app role for any other page', async () => {
    await loadPreloadFor('/somewhere/else.html')
    expect(Object.keys(exposed).sort()).toEqual(['turntable', 'turntableQobuz', 'turntableSoundCloud', 'turntableSpotify', 'turntableYouTube'])
  })
})

describe('YouTube player lookup', () => {
  it('asks the main process where the player page is', async () => {
    invoke.mockResolvedValue('http://127.0.0.1:5000/youtube-player.html')
    await loadPreloadFor('/app/out/renderer/index.html')
    expect(await (exposed.turntableYouTube as { getPlayerUrl(): Promise<string> }).getPlayerUrl()).toBe('http://127.0.0.1:5000/youtube-player.html')
    expect(invoke).toHaveBeenCalledWith('youtube:player-url')
  })

  it('is not given to the Spotify player page', async () => {
    await loadPreloadFor('/app/out/renderer/spotify-player.html')
    expect(exposed.turntableYouTube).toBeUndefined()
    expect(exposed.turntableSoundCloud).toBeUndefined()
    expect(exposed.turntableQobuz).toBeUndefined()
  })
})

describe('Qobuz stream lookup', () => {
  it('asks the main process, which signs the request, where to stream a track from', async () => {
    invoke.mockResolvedValue({ url: 'https://streaming.example/track.flac', quality: { codec: 'flac', lossless: true } })
    await loadPreloadFor('/app/out/renderer/index.html')
    const result = await (exposed.turntableQobuz as { getStreamUrl(id: string): Promise<{ url: string }> }).getStreamUrl('12345')
    expect(result.url).toBe('https://streaming.example/track.flac')
    expect(invoke).toHaveBeenCalledWith('qobuz:stream-url', '12345')
  })
})

describe('SoundCloud player lookup', () => {
  it('asks the main process where the player page is', async () => {
    invoke.mockResolvedValue('http://127.0.0.1:5000/soundcloud-player.html')
    await loadPreloadFor('/app/out/renderer/index.html')
    expect(await (exposed.turntableSoundCloud as { getPlayerUrl(): Promise<string> }).getPlayerUrl()).toBe('http://127.0.0.1:5000/soundcloud-player.html')
    expect(invoke).toHaveBeenCalledWith('soundcloud:player-url')
  })
})

describe('player page bridge', () => {
  const bridge = async () => {
    await loadPreloadFor('/x/spotify-player.html')
    return exposed.turntableSpotifyPage as { getToken(): Promise<string>; emit(e: unknown): void; onCommand(cb: (c: unknown) => void): void }
  }

  it('fetches the token over the page-only channel', async () => {
    invoke.mockResolvedValue('the-token')
    expect(await (await bridge()).getToken()).toBe('the-token')
    expect(invoke).toHaveBeenCalledWith('spotify-player:get-token')
  })

  it('turns a wrapped IPC failure into a message the user can read', async () => {
    invoke.mockRejectedValue(new Error("Error invoking remote method 'spotify-player:get-token': PlaybackPermissionError: Reconnect Spotify to allow playback in Muze."))
    await expect((await bridge()).getToken()).rejects.toThrow(/^Reconnect Spotify to allow playback in Muze\.$/)
  })

  it('reports events on the page-only channel, and delivers commands to the page', async () => {
    const b = await bridge()
    b.emit({ type: 'not-ready' })
    expect(send).toHaveBeenCalledWith('spotify-player:event', { type: 'not-ready' })

    const listener = vi.fn()
    b.onCommand(listener)
    const [channel, handler] = on.mock.calls[0] as [string, (e: unknown, c: unknown) => void]
    expect(channel).toBe('spotify-player:command')
    handler({}, { type: 'pause' })
    expect(listener).toHaveBeenCalledWith({ type: 'pause' })
  })
})

describe('app window Spotify controls', () => {
  const spotify = async () => {
    await loadPreloadFor('/x/index.html')
    return exposed.turntableSpotify as Record<string, (...args: unknown[]) => unknown>
  }

  it('forwards each control to its own channel', async () => {
    const api = await spotify()
    await api.play!('abc')
    await api.pause!()
    await api.resume!()
    await api.seek!(1500)
    await api.setVolume!(0.5)
    expect(invoke.mock.calls).toEqual([
      ['spotify:play', 'abc'],
      ['spotify:pause'],
      ['spotify:resume'],
      ['spotify:seek', 1500],
      ['spotify:set-volume', 0.5]
    ])
  })

  it('subscribes to events and unsubscribes cleanly', async () => {
    const api = await spotify()
    const listener = vi.fn()
    const unsubscribe = api.onEvent!(listener) as () => void

    const [channel, handler] = on.mock.calls[0] as [string, (e: unknown, p: unknown) => void]
    expect(channel).toBe('spotify:event')
    handler({}, { type: 'not-ready' })
    expect(listener).toHaveBeenCalledWith({ type: 'not-ready' })

    unsubscribe()
    expect(removeListener).toHaveBeenCalledWith('spotify:event', handler)
  })
})
