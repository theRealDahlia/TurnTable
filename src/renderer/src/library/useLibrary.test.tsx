// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TurnTableApi } from '@shared/ipc'
import type { ProviderStatus, Track, TrackPage } from '@shared/types'
import { useLibrary } from './useLibrary'

const status = (id: ProviderStatus['id'], connected: boolean): ProviderStatus => ({
  id,
  name: id,
  authKind: 'oauth-pkce',
  playback: 'sdk',
  maxQuality: { codec: 'aac', lossless: false },
  connected
})

const track = (providerId: Track['providerId'], n: number): Track => ({
  id: `${providerId}-${n}`,
  providerId,
  title: `Song ${n}`,
  artists: ['A'],
  durationMs: 1000
})

const page = (providerId: Track['providerId'], ns: number[], nextCursor?: string): TrackPage => ({
  tracks: ns.map((n) => track(providerId, n)),
  nextCursor
})

let api: { [K in keyof TurnTableApi]: ReturnType<typeof vi.fn> }

beforeEach(() => {
  api = {
    listProviders: vi.fn().mockResolvedValue([status('spotify', true), status('qobuz', false)]),
    connectProvider: vi.fn(),
    disconnectProvider: vi.fn(),
    getSavedTracks: vi.fn().mockResolvedValue(page('spotify', [1]))
  }
  Object.assign(window, { turntable: api })
})
afterEach(cleanup)

describe('useLibrary', () => {
  it('starts in the listing phase, then loads only connected services', async () => {
    const { result } = renderHook(() => useLibrary())
    expect(result.current.listing).toBe(true)
    expect(result.current.loading).toBe(true)

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.listing).toBe(false)
    expect(api.getSavedTracks).toHaveBeenCalledTimes(1)
    expect(api.getSavedTracks).toHaveBeenCalledWith('spotify', undefined)
    expect(result.current.tracks.map((t) => t.id)).toEqual(['spotify-1'])
  })

  it('follows cursors until the last page and accumulates tracks', async () => {
    api.getSavedTracks
      .mockResolvedValueOnce(page('spotify', [1, 2], '2'))
      .mockResolvedValueOnce(page('spotify', [3, 4], '4'))
      .mockResolvedValueOnce(page('spotify', [5]))

    const { result } = renderHook(() => useLibrary())
    await waitFor(() => expect(result.current.libraries.spotify?.status).toBe('ready'))

    expect(api.getSavedTracks.mock.calls.map((call) => call[1])).toEqual([undefined, '2', '4'])
    expect(result.current.tracks).toHaveLength(5)
  })

  it('merges several services in provider order and loads them in parallel', async () => {
    api.listProviders.mockResolvedValue([status('spotify', true), status('soundcloud', true)])
    api.getSavedTracks.mockImplementation(async (id: 'spotify' | 'soundcloud') => page(id, [1]))

    const { result } = renderHook(() => useLibrary())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.tracks.map((t) => t.id)).toEqual(['spotify-1', 'soundcloud-1'])
  })

  it('keeps a failing service from blocking the others, and keeps what it already loaded', async () => {
    api.listProviders.mockResolvedValue([status('spotify', true), status('soundcloud', true)])
    api.getSavedTracks.mockImplementation(async (id: string, cursor?: string) => {
      if (id === 'soundcloud') return page('soundcloud', [1])
      if (!cursor) return page('spotify', [1], '1')
      throw new Error("Error invoking remote method 'library:saved-tracks': Error: Spotify request failed with status 500")
    })

    const { result } = renderHook(() => useLibrary())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.libraries.spotify).toMatchObject({
      status: 'error',
      error: 'Spotify request failed with status 500'
    })
    expect(result.current.libraries.soundcloud?.status).toBe('ready')
    expect(result.current.tracks.map((t) => t.id)).toEqual(['spotify-1', 'soundcloud-1'])
  })

  it('retries one service from scratch without duplicating tracks', async () => {
    api.getSavedTracks
      .mockResolvedValueOnce(page('spotify', [1], '1'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(page('spotify', [1, 2]))

    const { result } = renderHook(() => useLibrary())
    await waitFor(() => expect(result.current.libraries.spotify?.status).toBe('error'))

    act(() => result.current.retry('spotify'))
    await waitFor(() => expect(result.current.libraries.spotify?.status).toBe('ready'))

    expect(result.current.tracks.map((t) => t.id)).toEqual(['spotify-1', 'spotify-2'])
  })

  it('reports a failure to list services', async () => {
    api.listProviders.mockRejectedValue(new Error('no bridge'))
    const { result } = renderHook(() => useLibrary())

    await waitFor(() => expect(result.current.error).toBe('no bridge'))
    expect(result.current.listing).toBe(false)
  })

  it('reload() re-checks connections and re-fetches', async () => {
    const { result } = renderHook(() => useLibrary())
    await waitFor(() => expect(result.current.loading).toBe(false))

    api.listProviders.mockResolvedValue([status('spotify', false), status('qobuz', false)])
    act(() => result.current.reload())

    await waitFor(() => expect(result.current.tracks).toHaveLength(0))
    expect(api.getSavedTracks).toHaveBeenCalledTimes(1)
  })

  it('drops results from a run that was superseded by a reload', async () => {
    let finishStale!: (p: TrackPage) => void
    api.getSavedTracks
      .mockReturnValueOnce(new Promise<TrackPage>((resolve) => (finishStale = resolve)))
      .mockResolvedValueOnce(page('spotify', [9]))

    const { result } = renderHook(() => useLibrary())
    await waitFor(() => expect(api.getSavedTracks).toHaveBeenCalledTimes(1))

    act(() => result.current.reload())
    await waitFor(() => expect(result.current.libraries.spotify?.status).toBe('ready'))
    await act(async () => finishStale(page('spotify', [1, 2, 3])))

    expect(result.current.tracks.map((t) => t.id)).toEqual(['spotify-9'])
  })

  it('ignores results that arrive after unmount', async () => {
    let finish!: (p: TrackPage) => void
    api.getSavedTracks.mockReturnValue(new Promise<TrackPage>((resolve) => (finish = resolve)))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const { unmount } = renderHook(() => useLibrary())
    await waitFor(() => expect(api.getSavedTracks).toHaveBeenCalled())
    unmount()
    await act(async () => finish(page('spotify', [1])))

    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => (resolve = res))
  return { promise, resolve }
}

describe('useLibrary.refreshProvider', () => {
  const bothConnected = (): ProviderStatus[] => [status('spotify', true), status('soundcloud', true)]
  const byId = async (id: 'spotify' | 'soundcloud'): Promise<TrackPage> => page(id, [1])
  const requestedServices = (): unknown[] => api.getSavedTracks.mock.calls.map((call) => call[0])

  /** Renders the hook with both services connected and waits until everything has loaded once. */
  async function loadedWithBoth() {
    api.listProviders.mockResolvedValue(bothConnected())
    api.getSavedTracks.mockImplementation(byId)
    const hook = renderHook(() => useLibrary())
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    api.listProviders.mockClear()
    api.getSavedTracks.mockClear()
    return hook
  }

  it('reloads only the service that changed, and leaves the others as they were', async () => {
    const { result } = await loadedWithBoth()
    api.getSavedTracks.mockImplementation(async (id: 'spotify' | 'soundcloud') => page(id, [1, 2]))

    act(() => result.current.refreshProvider('soundcloud'))
    await waitFor(() => expect(result.current.libraries.soundcloud?.tracks).toHaveLength(2))

    expect(api.listProviders).toHaveBeenCalledOnce()
    expect(requestedServices()).toEqual(['soundcloud'])
    expect(result.current.libraries.spotify?.tracks).toHaveLength(1)
  })

  it('loads a service that has just been connected without touching the others', async () => {
    api.listProviders.mockResolvedValue([status('spotify', true), status('soundcloud', false)])
    api.getSavedTracks.mockImplementation(byId)
    const { result } = renderHook(() => useLibrary())
    await waitFor(() => expect(result.current.loading).toBe(false))
    api.getSavedTracks.mockClear()

    api.listProviders.mockResolvedValue(bothConnected())
    act(() => result.current.refreshProvider('soundcloud'))
    await waitFor(() => expect(result.current.libraries.soundcloud?.status).toBe('ready'))

    expect(requestedServices()).toEqual(['soundcloud'])
    expect(result.current.providers.find((p) => p.id === 'soundcloud')?.connected).toBe(true)
    expect(result.current.tracks.map((t) => t.id)).toEqual(['spotify-1', 'soundcloud-1'])
  })

  it('drops a service that has been disconnected, fetches nothing, and keeps the rest', async () => {
    const { result } = await loadedWithBoth()

    api.listProviders.mockResolvedValue([status('spotify', true), status('soundcloud', false)])
    act(() => result.current.refreshProvider('soundcloud'))
    await waitFor(() => expect(result.current.libraries.soundcloud).toBeUndefined())

    expect(api.getSavedTracks).not.toHaveBeenCalled()
    expect(result.current.tracks.map((t) => t.id)).toEqual(['spotify-1'])
  })

  it('uses the new connection status for every service, e.g. one that needs reconnecting', async () => {
    const { result } = await loadedWithBoth()

    api.listProviders.mockResolvedValue([{ ...status('spotify', true), needsReauthorization: true }, status('soundcloud', true)])
    act(() => result.current.refreshProvider('soundcloud'))
    await waitFor(() => expect(result.current.providers[0]?.needsReauthorization).toBe(true))
  })

  it('applies answers in the order the changes were made', async () => {
    const { result } = await loadedWithBoth()
    const first = deferred<ProviderStatus[]>()
    api.listProviders.mockReturnValueOnce(first.promise).mockResolvedValueOnce(bothConnected())

    act(() => {
      result.current.refreshProvider('spotify')
      result.current.refreshProvider('soundcloud')
    })
    // The second check waits for the first, so a slow answer can never overwrite a newer one.
    await waitFor(() => expect(api.listProviders).toHaveBeenCalledTimes(1))
    await act(async () => {})
    expect(api.listProviders).toHaveBeenCalledTimes(1)

    await act(async () => first.resolve([status('spotify', true), status('soundcloud', false)]))
    await waitFor(() => expect(result.current.libraries.soundcloud?.status).toBe('ready'))

    expect(api.listProviders).toHaveBeenCalledTimes(2)
    expect(requestedServices()).toEqual(['spotify', 'soundcloud'])
    expect(result.current.providers.find((p) => p.id === 'soundcloud')?.connected).toBe(true)
  })

  it('does not disturb another service that is still loading', async () => {
    const spotifyPage = deferred<TrackPage>()
    api.listProviders.mockResolvedValue([status('spotify', true), status('soundcloud', false)])
    api.getSavedTracks.mockImplementation((id: string) => (id === 'spotify' ? spotifyPage.promise : Promise.resolve(page('soundcloud', [1]))))
    const { result } = renderHook(() => useLibrary())
    await waitFor(() => expect(result.current.libraries.spotify?.status).toBe('loading'))

    api.listProviders.mockResolvedValue(bothConnected())
    act(() => result.current.refreshProvider('soundcloud'))
    await waitFor(() => expect(result.current.libraries.soundcloud?.status).toBe('ready'))
    await act(async () => spotifyPage.resolve(page('spotify', [1, 2])))

    expect(result.current.libraries.spotify).toMatchObject({ status: 'ready' })
    expect(result.current.libraries.spotify?.tracks).toHaveLength(2)
    expect(requestedServices().filter((id) => id === 'spotify')).toHaveLength(1)
  })

  it('lets a newer load of the same service replace an older one that is still in flight', async () => {
    const { result } = await loadedWithBoth()
    const old = deferred<TrackPage>()
    api.getSavedTracks.mockReturnValueOnce(old.promise).mockResolvedValueOnce(page('soundcloud', [7, 8]))

    act(() => result.current.refreshProvider('soundcloud'))
    await waitFor(() => expect(api.getSavedTracks).toHaveBeenCalledTimes(1))
    act(() => result.current.refreshProvider('soundcloud'))
    await waitFor(() => expect(result.current.libraries.soundcloud?.status).toBe('ready'))
    await act(async () => old.resolve(page('soundcloud', [1, 2, 3])))

    expect(result.current.libraries.soundcloud?.tracks.map((t) => t.id)).toEqual(['soundcloud-7', 'soundcloud-8'])
  })

  it('ignores the late results of a service that was disconnected while it was loading', async () => {
    const soundcloudPage = deferred<TrackPage>()
    api.listProviders.mockResolvedValue(bothConnected())
    api.getSavedTracks.mockImplementation((id: string) => (id === 'soundcloud' ? soundcloudPage.promise : Promise.resolve(page('spotify', [1]))))
    const { result } = renderHook(() => useLibrary())
    await waitFor(() => expect(result.current.libraries.soundcloud?.status).toBe('loading'))

    api.listProviders.mockResolvedValue([status('spotify', true), status('soundcloud', false)])
    act(() => result.current.refreshProvider('soundcloud'))
    await waitFor(() => expect(result.current.libraries.soundcloud).toBeUndefined())
    await act(async () => soundcloudPage.resolve(page('soundcloud', [1, 2, 3])))

    expect(result.current.libraries.soundcloud).toBeUndefined()
    expect(result.current.tracks.map((t) => t.id)).toEqual(['spotify-1'])
  })

  it('starts over instead, if asked before the first check of connections has finished', async () => {
    const firstCheck = deferred<ProviderStatus[]>()
    api.listProviders.mockReturnValueOnce(firstCheck.promise)
    const { result } = renderHook(() => useLibrary())
    expect(result.current.listing).toBe(true)

    act(() => result.current.refreshProvider('spotify'))
    await waitFor(() => expect(result.current.libraries.spotify?.status).toBe('ready'))
    await act(async () => firstCheck.resolve([status('spotify', true), status('qobuz', false)]))

    expect(api.listProviders).toHaveBeenCalledTimes(2)
    expect(requestedServices()).toEqual(['spotify'])
    expect(result.current.tracks).toHaveLength(1)
  })

  it('also starts over if the earlier check of connections had failed', async () => {
    api.listProviders.mockRejectedValueOnce(new Error('boom'))
    const { result } = renderHook(() => useLibrary())
    await waitFor(() => expect(result.current.error).toBe('boom'))

    act(() => result.current.refreshProvider('spotify'))
    await waitFor(() => expect(result.current.libraries.spotify?.status).toBe('ready'))

    expect(result.current.error).toBeUndefined()
  })

  it('reports a failure to check connections, but keeps everything already loaded', async () => {
    const { result } = await loadedWithBoth()
    api.listProviders.mockRejectedValueOnce(new Error("Error invoking remote method 'providers:list': Error: boom"))

    act(() => result.current.refreshProvider('soundcloud'))
    await waitFor(() => expect(result.current.error).toBe('boom'))

    expect(result.current.tracks).toHaveLength(2)
    expect(api.getSavedTracks).not.toHaveBeenCalled()
  })

  it('keeps working for later changes after a failed check', async () => {
    const { result } = await loadedWithBoth()
    api.listProviders.mockRejectedValueOnce(new Error('boom'))
    act(() => result.current.refreshProvider('soundcloud'))
    await waitFor(() => expect(result.current.error).toBe('boom'))

    // The page offers a full reload after an error; it restores a normal state.
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.error).toBeUndefined())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.tracks).toHaveLength(2)
  })

  it('ignores an answer that arrives after a full reload, which redoes everything anyway', async () => {
    const { result } = await loadedWithBoth()
    const slow = deferred<ProviderStatus[]>()
    api.listProviders.mockReturnValueOnce(slow.promise)

    act(() => result.current.refreshProvider('soundcloud'))
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => slow.resolve(bothConnected()))

    // Only the full reload fetched anything: one request per service, not two for soundcloud.
    expect(requestedServices().sort()).toEqual(['soundcloud', 'spotify'])
  })

  it('ignores an answer that arrives after the page has gone away', async () => {
    const { result, unmount } = await loadedWithBoth()
    const slow = deferred<ProviderStatus[]>()
    api.listProviders.mockReturnValueOnce(slow.promise)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    act(() => result.current.refreshProvider('soundcloud'))
    unmount()
    await act(async () => slow.resolve(bothConnected()))

    expect(api.getSavedTracks).not.toHaveBeenCalled()
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })
})
