// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
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
    getSavedTracks: vi.fn().mockResolvedValue(page('spotify', [1])),
    searchTracks: vi.fn(),
    saveTrack: vi.fn(),
    unsaveTrack: vi.fn()
  }
  Object.assign(window, { turntable: api })
})
afterEach(cleanup)

/** Stands in for a page that opens every connected service's library, which is what the whole library loading used to be. */
function useOpenedLibrary(): ReturnType<typeof useLibrary> {
  const library = useLibrary()
  const { ensure, providers } = library
  useEffect(() => {
    for (const provider of providers) if (provider.connected) ensure(provider.id)
  }, [ensure, providers])
  return library
}

describe('useLibrary', () => {
  it('starts in the listing phase, then loads only connected services', async () => {
    const { result } = renderHook(() => useOpenedLibrary())
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

    const { result } = renderHook(() => useOpenedLibrary())
    await waitFor(() => expect(result.current.libraries.spotify?.status).toBe('ready'))

    expect(api.getSavedTracks.mock.calls.map((call) => call[1])).toEqual([undefined, '2', '4'])
    expect(result.current.tracks).toHaveLength(5)
  })

  it('merges several services in provider order and loads them in parallel', async () => {
    api.listProviders.mockResolvedValue([status('spotify', true), status('soundcloud', true)])
    api.getSavedTracks.mockImplementation(async (id: 'spotify' | 'soundcloud') => page(id, [1]))

    const { result } = renderHook(() => useOpenedLibrary())
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

    const { result } = renderHook(() => useOpenedLibrary())
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

    const { result } = renderHook(() => useOpenedLibrary())
    await waitFor(() => expect(result.current.libraries.spotify?.status).toBe('error'))

    act(() => result.current.retry('spotify'))
    await waitFor(() => expect(result.current.libraries.spotify?.status).toBe('ready'))

    expect(result.current.tracks.map((t) => t.id)).toEqual(['spotify-1', 'spotify-2'])
  })

  it('reports a failure to list services', async () => {
    api.listProviders.mockRejectedValue(new Error('no bridge'))
    const { result } = renderHook(() => useOpenedLibrary())

    await waitFor(() => expect(result.current.error).toBe('no bridge'))
    expect(result.current.listing).toBe(false)
  })

  it('reload() re-checks connections and re-fetches', async () => {
    const { result } = renderHook(() => useOpenedLibrary())
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

    const { result } = renderHook(() => useOpenedLibrary())
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

    const { unmount } = renderHook(() => useOpenedLibrary())
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
    const hook = renderHook(() => useOpenedLibrary())
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
    const { result } = renderHook(() => useOpenedLibrary())
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
    const { result } = renderHook(() => useOpenedLibrary())
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
    const { result } = renderHook(() => useOpenedLibrary())
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
    const { result } = renderHook(() => useOpenedLibrary())
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
    const { result } = renderHook(() => useOpenedLibrary())
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

describe('useLibrary.refresh', () => {
  const bothConnected = (): ProviderStatus[] => [status('spotify', true), status('soundcloud', true)]
  const titlesOf = (tracks: Track[] | undefined): string[] => (tracks ?? []).map((t) => t.id)

  /** A request that stays open until the test answers it. */
  function deferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (error: Error) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    return { promise, resolve, reject }
  }

  async function loaded(initial: (id: 'spotify' | 'soundcloud') => TrackPage = (id) => page(id, [1])) {
    api.listProviders.mockResolvedValue(bothConnected())
    api.getSavedTracks.mockImplementation(async (id: 'spotify' | 'soundcloud') => initial(id))
    const hook = renderHook(() => useOpenedLibrary())
    await waitFor(() => expect(hook.result.current.loading).toBe(false))
    api.listProviders.mockClear()
    api.getSavedTracks.mockClear()
    return hook
  }

  it('re-checks connections and re-reads every connected service', async () => {
    const { result } = await loaded()
    api.getSavedTracks.mockImplementation(async (id: 'spotify' | 'soundcloud') => page(id, [1, 2]))

    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.libraries.spotify?.tracks).toHaveLength(2))

    expect(api.listProviders).toHaveBeenCalledOnce()
    expect(api.getSavedTracks.mock.calls.map((call) => call[0]).sort()).toEqual(['soundcloud', 'spotify'])
    expect(titlesOf(result.current.libraries.soundcloud?.tracks)).toEqual(['soundcloud-1', 'soundcloud-2'])
    expect(result.current.refreshing).toBe(false)
    expect(result.current.loading).toBe(false)
  })

  it('refreshes only the service asked for, and leaves the other exactly as it was', async () => {
    const { result } = await loaded()
    api.getSavedTracks.mockImplementation(async (id: 'spotify' | 'soundcloud') => page(id, [1, 2]))

    act(() => result.current.refresh('soundcloud'))
    await waitFor(() => expect(titlesOf(result.current.libraries.soundcloud?.tracks)).toEqual(['soundcloud-1', 'soundcloud-2']))

    expect(api.getSavedTracks.mock.calls.map((call) => call[0])).toEqual(['soundcloud'])
    expect(titlesOf(result.current.libraries.spotify?.tracks)).toEqual(['spotify-1'])
    expect(result.current.libraries.spotify?.status).toBe('ready')
    expect(result.current.refreshing).toBe(false)
  })

  it('keeps showing the one service\'s old list while only it refreshes', async () => {
    const { result } = await loaded()
    const slow = deferred<TrackPage>()
    api.getSavedTracks.mockImplementation(() => slow.promise)

    act(() => result.current.refresh('spotify'))
    await waitFor(() => expect(result.current.refreshing).toBe(true))
    expect(titlesOf(result.current.libraries.spotify?.tracks)).toEqual(['spotify-1'])
    expect(result.current.libraries.soundcloud?.status).toBe('ready')

    await act(async () => slow.resolve(page('spotify', [3, 4])))
    await waitFor(() => expect(result.current.refreshing).toBe(false))
    expect(titlesOf(result.current.libraries.spotify?.tracks)).toEqual(['spotify-3', 'spotify-4'])
  })

  it('still re-checks connections for a single-service refresh, and drops a service that is gone', async () => {
    const { result } = await loaded()
    api.listProviders.mockResolvedValue([status('spotify', true), status('soundcloud', false)])

    act(() => result.current.refresh('spotify'))
    await waitFor(() => expect(result.current.libraries.soundcloud).toBeUndefined())

    expect(api.listProviders).toHaveBeenCalledOnce()
    expect(api.getSavedTracks.mock.calls.map((call) => call[0])).toEqual(['spotify'])
  })

  it('fetches nothing for a service that turns out to be disconnected', async () => {
    const { result } = await loaded()
    api.listProviders.mockResolvedValue([status('spotify', false), status('soundcloud', true)])

    act(() => result.current.refresh('spotify'))
    await waitFor(() => expect(result.current.libraries.spotify).toBeUndefined())

    expect(api.getSavedTracks).not.toHaveBeenCalled()
    expect(titlesOf(result.current.libraries.soundcloud?.tracks)).toEqual(['soundcloud-1'])
  })

  it('keeps the old list on screen until the new one is complete, then swaps it in whole', async () => {
    const { result } = await loaded()
    const first = deferred<TrackPage>()
    const second = deferred<TrackPage>()
    api.getSavedTracks.mockImplementation((id: 'spotify' | 'soundcloud', cursor?: string) =>
      id === 'soundcloud' ? Promise.resolve(page(id, [1])) : cursor ? second.promise : first.promise
    )

    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.refreshing).toBe(true))
    expect(titlesOf(result.current.libraries.spotify?.tracks)).toEqual(['spotify-1'])
    expect(result.current.loading).toBe(true)

    await act(async () => first.resolve(page('spotify', [5, 6], 'more')))
    // A page has arrived, but the list on screen has not been touched.
    expect(titlesOf(result.current.libraries.spotify?.tracks)).toEqual(['spotify-1'])
    expect(result.current.tracks.filter((t) => t.providerId === 'spotify')).toHaveLength(1)

    await act(async () => second.resolve(page('spotify', [7])))
    await waitFor(() => expect(result.current.refreshing).toBe(false))
    expect(titlesOf(result.current.libraries.spotify?.tracks)).toEqual(['spotify-5', 'spotify-6', 'spotify-7'])
    expect(result.current.libraries.spotify?.incoming).toBeUndefined()
    expect(result.current.libraries.spotify?.status).toBe('ready')
  })

  it('shows a song that was removed elsewhere as gone, and one that was added as new', async () => {
    const { result } = await loaded((id) => page(id, [1, 2, 3]))
    api.getSavedTracks.mockImplementation(async (id: 'spotify' | 'soundcloud') => page(id, [2, 3, 4]))

    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.refreshing).toBe(false))
    await waitFor(() => expect(titlesOf(result.current.libraries.spotify?.tracks)).toEqual(['spotify-2', 'spotify-3', 'spotify-4']))
  })

  it('keeps the old list, and says what went wrong, when a service fails to refresh', async () => {
    const { result } = await loaded()
    api.getSavedTracks.mockImplementation(async (id: 'spotify' | 'soundcloud', cursor?: string) => {
      if (id === 'spotify' && !cursor) return { tracks: [track('spotify', 9)], nextCursor: 'more' }
      if (id === 'spotify') throw new Error('Spotify is limiting requests')
      return page(id, [1, 2])
    })

    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.libraries.spotify?.status).toBe('error'))

    expect(result.current.libraries.spotify?.error).toBe('Spotify is limiting requests')
    expect(titlesOf(result.current.libraries.spotify?.tracks)).toEqual(['spotify-1'])
    expect(result.current.libraries.spotify?.incoming).toBeUndefined()
    // The other service still refreshed.
    await waitFor(() => expect(titlesOf(result.current.libraries.soundcloud?.tracks)).toEqual(['soundcloud-1', 'soundcloud-2']))
    expect(result.current.refreshing).toBe(false)
  })

  it('can be retried after a failed refresh without duplicating tracks', async () => {
    const { result } = await loaded()
    api.getSavedTracks.mockRejectedValueOnce(new Error('offline'))
    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.libraries.spotify?.status).toBe('error'))

    api.getSavedTracks.mockImplementation(async (id: 'spotify' | 'soundcloud') => page(id, [1]))
    act(() => result.current.retry('spotify'))
    await waitFor(() => expect(result.current.libraries.spotify?.status).toBe('ready'))
    expect(titlesOf(result.current.libraries.spotify?.tracks)).toEqual(['spotify-1'])
  })

  it('drops a service that is no longer connected and loads one that has just been connected', async () => {
    api.listProviders.mockResolvedValue([status('spotify', true), status('soundcloud', false)])
    api.getSavedTracks.mockImplementation(async (id: 'spotify' | 'soundcloud') => page(id, [1]))
    const { result } = renderHook(() => useOpenedLibrary())
    await waitFor(() => expect(result.current.loading).toBe(false))
    api.getSavedTracks.mockClear()

    api.listProviders.mockResolvedValue([status('spotify', false), status('soundcloud', true)])
    act(() => result.current.refresh())

    await waitFor(() => expect(titlesOf(result.current.libraries.soundcloud?.tracks)).toEqual(['soundcloud-1']))
    expect(result.current.libraries.spotify).toBeUndefined()
    expect(api.getSavedTracks.mock.calls.map((call) => call[0])).toEqual(['soundcloud'])
  })

  it('streams in a service that had nothing before, instead of making it wait for the whole list', async () => {
    api.listProviders.mockResolvedValue([status('spotify', true)])
    api.getSavedTracks.mockImplementation(async () => ({ tracks: [], nextCursor: undefined }))
    const { result } = renderHook(() => useOpenedLibrary())
    await waitFor(() => expect(result.current.loading).toBe(false))

    const first = deferred<TrackPage>()
    const second = deferred<TrackPage>()
    api.getSavedTracks.mockImplementation((_id: string, cursor?: string) => (cursor ? second.promise : first.promise))
    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.loading).toBe(true))
    await act(async () => first.resolve(page('spotify', [1], 'more')))

    expect(titlesOf(result.current.libraries.spotify?.tracks)).toEqual(['spotify-1'])
    expect(result.current.refreshing).toBe(false)
    await act(async () => second.resolve(page('spotify', [2])))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(titlesOf(result.current.libraries.spotify?.tracks)).toEqual(['spotify-1', 'spotify-2'])
  })

  it('starts over instead, if asked before the first check of connections has finished', async () => {
    const pending = deferred<ProviderStatus[]>()
    api.listProviders.mockReturnValueOnce(pending.promise)
    const { result } = renderHook(() => useOpenedLibrary())
    expect(result.current.listing).toBe(true)

    api.listProviders.mockResolvedValue([status('spotify', true)])
    act(() => result.current.refresh())

    await waitFor(() => expect(result.current.listing).toBe(false))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(titlesOf(result.current.libraries.spotify?.tracks)).toEqual(['spotify-1'])
  })

  it('reports a failure to check connections, but keeps everything already loaded', async () => {
    const { result } = await loaded()
    api.listProviders.mockRejectedValueOnce(new Error('could not list'))

    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.error).toBe('could not list'))

    expect(titlesOf(result.current.libraries.spotify?.tracks)).toEqual(['spotify-1'])
    expect(api.getSavedTracks).not.toHaveBeenCalled()
  })

  it('ignores an answer that arrives after a full reload, which redoes everything anyway', async () => {
    const { result } = await loaded()
    const slowCheck = deferred<ProviderStatus[]>()
    api.listProviders.mockReturnValueOnce(slowCheck.promise)

    act(() => result.current.refresh())
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(async () => slowCheck.resolve(bothConnected()))

    // Only the full reload fetched anything: one request per service, not two.
    expect(api.getSavedTracks.mock.calls.map((call) => call[0]).sort()).toEqual(['soundcloud', 'spotify'])
  })

  it('does nothing once the page has gone away', async () => {
    const { result, unmount } = await loaded()
    const slowCheck = deferred<ProviderStatus[]>()
    api.listProviders.mockReturnValueOnce(slowCheck.promise)
    act(() => result.current.refresh())
    unmount()

    await act(async () => slowCheck.resolve(bothConnected()))
    expect(api.getSavedTracks).not.toHaveBeenCalled()
  })

  it('lets a newer refresh replace an older one that is still in flight', async () => {
    const { result } = await loaded()
    const stale = deferred<TrackPage>()
    api.getSavedTracks.mockImplementationOnce(() => stale.promise)
    api.getSavedTracks.mockImplementationOnce(async () => page('soundcloud', [1]))
    act(() => result.current.refresh())
    await waitFor(() => expect(api.getSavedTracks).toHaveBeenCalledTimes(2))

    api.getSavedTracks.mockImplementation(async (id: 'spotify' | 'soundcloud') => page(id, [8, 9]))
    act(() => result.current.refresh())
    await waitFor(() => expect(titlesOf(result.current.libraries.spotify?.tracks)).toEqual(['spotify-8', 'spotify-9']))

    await act(async () => stale.resolve(page('spotify', [100])))
    expect(titlesOf(result.current.libraries.spotify?.tracks)).toEqual(['spotify-8', 'spotify-9'])
  })
})

describe('useLibrary loading on demand', () => {
  const two = (): ProviderStatus[] => [status('spotify', true), status('youtubeMusic', true), status('local', true), status('qobuz', false)]
  const requested = (): string[] => api.getSavedTracks.mock.calls.map((call) => call[0] as string)
  beforeEach(() => {
    api.listProviders.mockResolvedValue(two())
    api.getSavedTracks.mockImplementation(async (id: ProviderStatus['id']) => page(id, [1]))
  })

  it('fetches nothing from a connected service until its library is opened, but reads local files at once', async () => {
    const { result } = renderHook(() => useLibrary())
    await waitFor(() => expect(result.current.listing).toBe(false))
    await waitFor(() => expect(result.current.libraries.local?.status).toBe('ready'))

    expect(requested()).toEqual(['local'])
    expect(result.current.libraries.spotify).toBeUndefined()
  })

  it('loads a service when it is opened, once, however often it is asked for', async () => {
    const { result } = renderHook(() => useLibrary())
    await waitFor(() => expect(result.current.listing).toBe(false))

    act(() => result.current.ensure('spotify'))
    act(() => result.current.ensure('spotify'))
    await waitFor(() => expect(result.current.libraries.spotify?.status).toBe('ready'))
    act(() => result.current.ensure('spotify'))

    expect(requested().filter((id) => id === 'spotify')).toHaveLength(1)
    expect(requested()).not.toContain('youtubeMusic')
  })

  it('does not load a service that is not connected, or one it has not heard of', async () => {
    const { result } = renderHook(() => useLibrary())
    await waitFor(() => expect(result.current.listing).toBe(false))

    act(() => result.current.ensure('qobuz'))
    act(() => result.current.ensure('soundcloud'))

    expect(requested()).not.toContain('qobuz')
    expect(requested()).not.toContain('soundcloud')
  })

  it("does not try a service again by itself after it failed; the user's Retry does", async () => {
    api.getSavedTracks.mockImplementation(async (id: ProviderStatus['id']) => {
      if (id === 'spotify') throw new Error('Spotify has temporarily limited access')
      return page(id, [1])
    })
    const { result } = renderHook(() => useLibrary())
    await waitFor(() => expect(result.current.listing).toBe(false))

    act(() => result.current.ensure('spotify'))
    await waitFor(() => expect(result.current.libraries.spotify?.status).toBe('error'))
    act(() => result.current.ensure('spotify'))

    expect(requested().filter((id) => id === 'spotify')).toHaveLength(1)
    act(() => result.current.retry('spotify'))
    await waitFor(() => expect(requested().filter((id) => id === 'spotify')).toHaveLength(2))
  })

  it('refreshes only the libraries that were opened when everything is refreshed', async () => {
    const { result } = renderHook(() => useLibrary())
    await waitFor(() => expect(result.current.listing).toBe(false))
    act(() => result.current.ensure('spotify'))
    await waitFor(() => expect(result.current.libraries.spotify?.status).toBe('ready'))
    api.getSavedTracks.mockClear()

    act(() => result.current.refresh())
    await waitFor(() => expect(requested().sort()).toEqual(['local', 'spotify']))

    expect(requested()).not.toContain('youtubeMusic')
  })

  it('refreshes a service that was asked for by name even if it was never opened', async () => {
    const { result } = renderHook(() => useLibrary())
    await waitFor(() => expect(result.current.listing).toBe(false))
    api.getSavedTracks.mockClear()

    act(() => result.current.refresh('youtubeMusic'))

    await waitFor(() => expect(requested()).toEqual(['youtubeMusic']))
  })

  it('leaves a service nobody opened alone when it is connected or changed, and loads it when it is opened', async () => {
    const { result } = renderHook(() => useLibrary())
    await waitFor(() => expect(result.current.listing).toBe(false))
    api.getSavedTracks.mockClear()

    act(() => result.current.refreshProvider('youtubeMusic'))
    await waitFor(() => expect(api.listProviders).toHaveBeenCalledTimes(2))
    expect(requested()).not.toContain('youtubeMusic')

    act(() => result.current.ensure('youtubeMusic'))
    await waitFor(() => expect(requested()).toContain('youtubeMusic'))
  })
})
