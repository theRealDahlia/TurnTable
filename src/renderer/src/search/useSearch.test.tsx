// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TurnTableApi } from '@shared/ipc'
import type { ProviderId, Track, TrackPage } from '@shared/types'
import { MAX_EMPTY_PAGES, trackKey, useSearch } from './useSearch'

const track = (providerId: ProviderId, n: number, saved = false): Track => ({
  id: `${providerId}-${n}`,
  providerId,
  title: `Song ${n}`,
  artists: ['Foo Fighters'],
  durationMs: 1000,
  saved
})
const page = (providerId: ProviderId, ns: number[], nextCursor?: string, saved: number[] = []): TrackPage => ({
  tracks: ns.map((n) => track(providerId, n, saved.includes(n))),
  nextCursor
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

let api: { [K in keyof TurnTableApi]: ReturnType<typeof vi.fn> }

beforeEach(() => {
  api = {
    listProviders: vi.fn(),
    connectProvider: vi.fn(),
    disconnectProvider: vi.fn(),
    getSavedTracks: vi.fn(),
    searchTracks: vi.fn(async (id: ProviderId) => page(id, [1, 2])),
    saveTrack: vi.fn().mockResolvedValue(undefined),
    unsaveTrack: vi.fn().mockResolvedValue(undefined)
  }
  Object.assign(window, { turntable: api })
})
afterEach(cleanup)

const idsOf = (tracks?: Track[]): string[] => (tracks ?? []).map((t) => t.id)

describe('useSearch searching', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useSearch())
    expect(result.current).toMatchObject({ query: '', results: {} })
    expect(result.current.tab).toBeUndefined()
  })

  it('searches every service at once, each with the same trimmed query, and keeps the results apart', async () => {
    const { result } = renderHook(() => useSearch())

    act(() => result.current.search('  foo fighters ', ['spotify', 'youtubeMusic']))
    expect(result.current.query).toBe('foo fighters')
    expect(result.current.results.spotify?.status).toBe('loading')
    expect(result.current.results.youtubeMusic?.status).toBe('loading')
    await waitFor(() => expect(result.current.results.youtubeMusic?.status).toBe('ready'))

    expect(api.searchTracks).toHaveBeenCalledWith('spotify', 'foo fighters')
    expect(api.searchTracks).toHaveBeenCalledWith('youtubeMusic', 'foo fighters')
    expect(idsOf(result.current.results.spotify?.tracks)).toEqual(['spotify-1', 'spotify-2'])
    expect(idsOf(result.current.results.youtubeMusic?.tracks)).toEqual(['youtubeMusic-1', 'youtubeMusic-2'])
  })

  it('shows the first service\'s tab to begin with, and lets the user pick another', async () => {
    const { result } = renderHook(() => useSearch())
    act(() => result.current.search('foo', ['spotify', 'youtubeMusic']))
    expect(result.current.tab).toBe('spotify')
    act(() => result.current.selectTab('youtubeMusic'))
    expect(result.current.tab).toBe('youtubeMusic')
  })

  it('keeps the chosen tab for the next search, if that service is still searched', async () => {
    const { result } = renderHook(() => useSearch())
    act(() => result.current.search('foo', ['spotify', 'youtubeMusic']))
    act(() => result.current.selectTab('youtubeMusic'))
    await waitFor(() => expect(result.current.results.spotify?.status).toBe('ready'))

    act(() => result.current.search('bar', ['spotify', 'youtubeMusic']))
    expect(result.current.tab).toBe('youtubeMusic')
    act(() => result.current.search('baz', ['spotify']))
    expect(result.current.tab).toBe('spotify')
  })

  it('lets a failing service fail alone', async () => {
    api.searchTracks.mockImplementation(async (id: ProviderId) => {
      if (id === 'spotify') throw new Error("Error invoking remote method 'library:search': Error: Spotify: rate limit")
      return page(id, [1])
    })
    const { result } = renderHook(() => useSearch())

    act(() => result.current.search('foo', ['spotify', 'youtubeMusic']))
    await waitFor(() => expect(result.current.results.spotify?.status).toBe('error'))
    await waitFor(() => expect(result.current.results.youtubeMusic?.status).toBe('ready'))

    expect(result.current.results.spotify?.error).toBe('Spotify: rate limit')
    expect(result.current.results.spotify?.tracks).toEqual([])
    expect(idsOf(result.current.results.youtubeMusic?.tracks)).toEqual(['youtubeMusic-1'])
  })

  it('retries just the failed service', async () => {
    api.searchTracks.mockImplementation(async (id: ProviderId) => {
      if (id === 'spotify') throw new Error('offline')
      return page(id, [1])
    })
    const { result } = renderHook(() => useSearch())
    act(() => result.current.search('foo', ['spotify', 'youtubeMusic']))
    await waitFor(() => expect(result.current.results.spotify?.status).toBe('error'))
    api.searchTracks.mockClear()
    api.searchTracks.mockImplementation(async (id: ProviderId) => page(id, [7]))

    act(() => result.current.retry('spotify'))
    expect(result.current.results.spotify?.status).toBe('loading')
    await waitFor(() => expect(result.current.results.spotify?.status).toBe('ready'))

    expect(api.searchTracks.mock.calls).toEqual([['spotify', 'foo']])
    expect(idsOf(result.current.results.spotify?.tracks)).toEqual(['spotify-7'])
    expect(idsOf(result.current.results.youtubeMusic?.tracks)).toEqual(['youtubeMusic-1'])
  })

  it('does not retry a service that did not fail, or before any search', async () => {
    const { result } = renderHook(() => useSearch())
    act(() => result.current.retry('spotify'))
    act(() => result.current.search('foo', ['spotify']))
    await waitFor(() => expect(result.current.results.spotify?.status).toBe('ready'))
    api.searchTracks.mockClear()
    act(() => result.current.retry('spotify'))
    expect(api.searchTracks).not.toHaveBeenCalled()
  })

  it.each(['', '   '])('ignores the empty query %j', (query) => {
    const { result } = renderHook(() => useSearch())
    act(() => result.current.search(query, ['spotify']))
    expect(api.searchTracks).not.toHaveBeenCalled()
    expect(result.current.query).toBe('')
  })

  it('only records the query when no service needs searching, for tabs that answer by themselves', () => {
    const { result } = renderHook(() => useSearch())
    act(() => result.current.search('foo', [], ['local']))
    expect(api.searchTracks).not.toHaveBeenCalled()
    expect(result.current.query).toBe('foo')
    expect(result.current.tab).toBe('local')
    expect(result.current.results).toEqual({})
  })

  it('keeps a chosen tab that is answered without a search, such as local files', () => {
    const { result } = renderHook(() => useSearch())
    act(() => result.current.search('foo', ['spotify'], ['spotify', 'local']))
    act(() => result.current.selectTab('local'))
    act(() => result.current.search('bar', ['spotify'], ['spotify', 'local']))
    expect(result.current.tab).toBe('local')
    act(() => result.current.search('baz', ['spotify'], ['spotify']))
    expect(result.current.tab).toBe('spotify')
  })

  it('drops the answers to an earlier search once a newer one has started', async () => {
    const slow = deferred<TrackPage>()
    api.searchTracks.mockImplementationOnce(() => slow.promise)
    const { result } = renderHook(() => useSearch())
    act(() => result.current.search('old', ['spotify']))

    api.searchTracks.mockImplementation(async (id: ProviderId) => page(id, [9]))
    act(() => result.current.search('new', ['spotify']))
    await waitFor(() => expect(result.current.results.spotify?.status).toBe('ready'))
    await act(async () => slow.resolve(page('spotify', [100])))

    expect(result.current.query).toBe('new')
    expect(idsOf(result.current.results.spotify?.tracks)).toEqual(['spotify-9'])
  })

  it('drops a late failure of an earlier search too', async () => {
    const slow = deferred<TrackPage>()
    api.searchTracks.mockImplementationOnce(() => slow.promise)
    const { result } = renderHook(() => useSearch())
    act(() => result.current.search('old', ['spotify']))
    act(() => result.current.search('new', ['spotify']))
    await waitFor(() => expect(result.current.results.spotify?.status).toBe('ready'))
    await act(async () => slow.reject(new Error('late')))
    expect(result.current.results.spotify?.status).toBe('ready')
  })
})

describe('useSearch paging', () => {
  it('appends the next page, using the cursor it was given', async () => {
    api.searchTracks.mockResolvedValueOnce(page('spotify', [1, 2], 'next-1'))
    api.searchTracks.mockResolvedValueOnce(page('spotify', [3], undefined))
    const { result } = renderHook(() => useSearch())
    act(() => result.current.search('foo', ['spotify']))
    await waitFor(() => expect(result.current.results.spotify?.nextCursor).toBe('next-1'))

    act(() => result.current.loadMore('spotify'))
    expect(result.current.results.spotify?.loadingMore).toBe(true)
    await waitFor(() => expect(result.current.results.spotify?.loadingMore).toBe(false))

    expect(api.searchTracks).toHaveBeenLastCalledWith('spotify', 'foo', 'next-1')
    expect(idsOf(result.current.results.spotify?.tracks)).toEqual(['spotify-1', 'spotify-2', 'spotify-3'])
    expect(result.current.results.spotify?.nextCursor).toBeUndefined()
  })

  it('does not ask twice while a page is loading, or when there is no more', async () => {
    const slow = deferred<TrackPage>()
    api.searchTracks.mockResolvedValueOnce(page('spotify', [1], 'next-1'))
    api.searchTracks.mockImplementationOnce(() => slow.promise)
    const { result } = renderHook(() => useSearch())
    act(() => result.current.search('foo', ['spotify']))
    await waitFor(() => expect(result.current.results.spotify?.nextCursor).toBe('next-1'))

    act(() => result.current.loadMore('spotify'))
    act(() => result.current.loadMore('spotify'))
    expect(api.searchTracks).toHaveBeenCalledTimes(2)
    await act(async () => slow.resolve(page('spotify', [2])))
    act(() => result.current.loadMore('spotify'))
    expect(api.searchTracks).toHaveBeenCalledTimes(2)
  })

  it('keeps the results already shown, and says why, when the next page fails', async () => {
    api.searchTracks.mockResolvedValueOnce(page('spotify', [1], 'next-1'))
    api.searchTracks.mockRejectedValueOnce(new Error('Spotify is limiting requests'))
    const { result } = renderHook(() => useSearch())
    act(() => result.current.search('foo', ['spotify']))
    await waitFor(() => expect(result.current.results.spotify?.nextCursor).toBe('next-1'))

    act(() => result.current.loadMore('spotify'))
    await waitFor(() => expect(result.current.saveError?.message).toBe('Spotify is limiting requests'))

    expect(idsOf(result.current.results.spotify?.tracks)).toEqual(['spotify-1'])
    expect(result.current.results.spotify?.loadingMore).toBe(false)
    expect(result.current.results.spotify?.nextCursor).toBe('next-1')
  })

  it('ignores a page that arrives after a new search', async () => {
    const slow = deferred<TrackPage>()
    api.searchTracks.mockResolvedValueOnce(page('spotify', [1], 'next-1'))
    api.searchTracks.mockImplementationOnce(() => slow.promise)
    const { result } = renderHook(() => useSearch())
    act(() => result.current.search('foo', ['spotify']))
    await waitFor(() => expect(result.current.results.spotify?.nextCursor).toBe('next-1'))
    act(() => result.current.loadMore('spotify'))

    api.searchTracks.mockResolvedValue(page('spotify', [50]))
    act(() => result.current.search('bar', ['spotify']))
    await waitFor(() => expect(result.current.results.spotify?.status).toBe('ready'))
    await act(async () => slow.resolve(page('spotify', [99])))

    expect(idsOf(result.current.results.spotify?.tracks)).toEqual(['spotify-50'])
  })
})

describe('useSearch saving', () => {
  async function searched(saved: number[] = [], onSaved?: (id: ProviderId) => void) {
    api.searchTracks.mockImplementation(async (id: ProviderId) => page(id, [1, 2], undefined, saved))
    const hook = renderHook(() => useSearch({ onSaved }))
    act(() => hook.result.current.search('foo', ['spotify', 'youtubeMusic']))
    await waitFor(() => expect(hook.result.current.results.youtubeMusic?.status).toBe('ready'))
    return hook
  }
  const savedOf = (tracks?: Track[]): (boolean | undefined)[] => (tracks ?? []).map((t) => t.saved)

  it('shows a save at once, sends it, and tells the caller that the library changed', async () => {
    const onSaved = vi.fn()
    const { result } = await searched([], onSaved)
    const target = result.current.results.spotify!.tracks[0]!

    act(() => result.current.toggleSave(target))
    expect(savedOf(result.current.results.spotify?.tracks)).toEqual([true, false])
    expect(result.current.pending[trackKey(target)]).toBe(true)
    await waitFor(() => expect(result.current.pending[trackKey(target)]).toBeUndefined())

    expect(api.saveTrack).toHaveBeenCalledExactlyOnceWith('spotify', 'spotify-1')
    expect(api.unsaveTrack).not.toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalledExactlyOnceWith('spotify')
    expect(result.current.saveError).toBeUndefined()
  })

  it('removes a track that is already saved', async () => {
    const onSaved = vi.fn()
    const { result } = await searched([1], onSaved)
    const target = result.current.results.youtubeMusic!.tracks[0]!
    expect(target.saved).toBe(true)

    act(() => result.current.toggleSave(target))
    expect(savedOf(result.current.results.youtubeMusic?.tracks)).toEqual([false, false])
    await waitFor(() => expect(onSaved).toHaveBeenCalled())

    expect(api.unsaveTrack).toHaveBeenCalledExactlyOnceWith('youtubeMusic', 'youtubeMusic-1')
    expect(api.saveTrack).not.toHaveBeenCalled()
  })

  it('only changes the one track on the one service', async () => {
    const { result } = await searched()
    act(() => result.current.toggleSave(result.current.results.spotify!.tracks[1]!))
    expect(savedOf(result.current.results.spotify?.tracks)).toEqual([false, true])
    expect(savedOf(result.current.results.youtubeMusic?.tracks)).toEqual([false, false])
  })

  it('puts the heart back, says why, and does not report a change, when saving fails', async () => {
    const onSaved = vi.fn()
    const { result } = await searched([], onSaved)
    api.saveTrack.mockRejectedValue(new Error("Error invoking remote method 'library:save': Error: Reconnect Spotify to allow saving songs in TurnTable."))

    act(() => result.current.toggleSave(result.current.results.spotify!.tracks[0]!))
    await waitFor(() => expect(result.current.saveError).toBeDefined())

    expect(result.current.saveError).toEqual({ providerId: 'spotify', message: 'Reconnect Spotify to allow saving songs in TurnTable.' })
    expect(savedOf(result.current.results.spotify?.tracks)).toEqual([false, false])
    expect(result.current.pending).toEqual({})
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('puts a removed track back as saved when removing fails', async () => {
    const { result } = await searched([1])
    api.unsaveTrack.mockRejectedValue(new Error('nope'))

    act(() => result.current.toggleSave(result.current.results.spotify!.tracks[0]!))
    await waitFor(() => expect(result.current.saveError?.message).toBe('nope'))

    expect(savedOf(result.current.results.spotify?.tracks)).toEqual([true, false])
  })

  it('clears an earlier error when the next change starts', async () => {
    const { result } = await searched()
    api.saveTrack.mockRejectedValueOnce(new Error('first'))
    act(() => result.current.toggleSave(result.current.results.spotify!.tracks[0]!))
    await waitFor(() => expect(result.current.saveError).toBeDefined())

    act(() => result.current.toggleSave(result.current.results.spotify!.tracks[0]!))
    expect(result.current.saveError).toBeUndefined()
  })

  it('ignores a second press on a track whose change is still being sent', async () => {
    const slow = deferred<void>()
    const { result } = await searched()
    api.saveTrack.mockImplementationOnce(() => slow.promise)
    const target = result.current.results.spotify!.tracks[0]!

    act(() => result.current.toggleSave(target))
    act(() => result.current.toggleSave(result.current.results.spotify!.tracks[0]!))
    expect(api.saveTrack).toHaveBeenCalledOnce()
    expect(api.unsaveTrack).not.toHaveBeenCalled()
    await act(async () => slow.resolve())
    await waitFor(() => expect(result.current.pending).toEqual({}))
  })

  it('lets two different tracks be changed at the same time', async () => {
    const { result } = await searched()
    act(() => result.current.toggleSave(result.current.results.spotify!.tracks[0]!))
    act(() => result.current.toggleSave(result.current.results.youtubeMusic!.tracks[0]!))
    expect(api.saveTrack).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(result.current.pending).toEqual({}))
  })

  it('still reports the library change if a new search started while it was being sent', async () => {
    const slow = deferred<void>()
    const onSaved = vi.fn()
    const { result } = await searched([], onSaved)
    api.saveTrack.mockImplementationOnce(() => slow.promise)
    act(() => result.current.toggleSave(result.current.results.spotify!.tracks[0]!))

    act(() => result.current.search('other', ['spotify']))
    await act(async () => slow.resolve())

    expect(onSaved).toHaveBeenCalledExactlyOnceWith('spotify')
  })

  it('does not reach into the new results when an old save fails', async () => {
    const slow = deferred<void>()
    const { result } = await searched()
    api.saveTrack.mockImplementationOnce(() => slow.promise)
    act(() => result.current.toggleSave(result.current.results.spotify!.tracks[0]!))
    act(() => result.current.search('other', ['spotify']))
    await waitFor(() => expect(result.current.results.spotify?.status).toBe('ready'))

    await act(async () => slow.reject(new Error('late failure')))

    expect(result.current.saveError).toBeUndefined()
  })
})

describe('useSearch pausing automatic loading', () => {
  const empty = (next?: string): TrackPage => ({ tracks: [], nextCursor: next })

  async function started(first: TrackPage) {
    api.searchTracks.mockResolvedValueOnce(first)
    const hook = renderHook(() => useSearch())
    act(() => hook.result.current.search('foo', ['spotify']))
    await waitFor(() => expect(hook.result.current.results.spotify?.status).toBe('ready'))
    return hook
  }
  const more = async (hook: Awaited<ReturnType<typeof started>>, response: TrackPage | Error) => {
    if (response instanceof Error) api.searchTracks.mockRejectedValueOnce(response)
    else api.searchTracks.mockResolvedValueOnce(response)
    const before = hook.result.current.results.spotify?.nextCursor
    act(() => hook.result.current.loadMore('spotify'))
    await waitFor(() => expect(hook.result.current.results.spotify?.loadingMore).toBe(false))
    return before
  }

  it('keeps loading on its own while pages have songs', async () => {
    const hook = await started(page('spotify', [1], 'c2'))
    await more(hook, page('spotify', [2], 'c3'))
    expect(hook.result.current.results.spotify).toMatchObject({ emptyPages: 0, paused: false })
  })

  it(`pauses after ${MAX_EMPTY_PAGES} empty pages in a row, counting the first page`, async () => {
    const hook = await started(empty('c2'))
    expect(hook.result.current.results.spotify).toMatchObject({ emptyPages: 1, paused: false })
    await more(hook, empty('c3'))
    expect(hook.result.current.results.spotify).toMatchObject({ emptyPages: 2, paused: true, nextCursor: 'c3' })
  })

  it('does not count empty pages that are not in a row', async () => {
    const hook = await started(page('spotify', [1], 'c2'))
    await more(hook, empty('c3'))
    await more(hook, page('spotify', [2], 'c4'))
    await more(hook, empty('c5'))
    expect(hook.result.current.results.spotify).toMatchObject({ emptyPages: 1, paused: false })
  })

  it('pauses when fetching more fails, and keeps what was found', async () => {
    const hook = await started(page('spotify', [1], 'c2'))
    await more(hook, new Error('limited'))
    expect(hook.result.current.results.spotify).toMatchObject({ paused: true, nextCursor: 'c2' })
    expect(idsOf(hook.result.current.results.spotify?.tracks)).toEqual(['spotify-1'])
  })

  it('resumes once the user asks for more and it finds something', async () => {
    const hook = await started(empty('c2'))
    await more(hook, empty('c3'))
    expect(hook.result.current.results.spotify?.paused).toBe(true)

    await more(hook, page('spotify', [5], 'c4'))
    expect(hook.result.current.results.spotify).toMatchObject({ paused: false, emptyPages: 0 })
  })

  it('stays paused if the user asks and it is empty again', async () => {
    const hook = await started(empty('c2'))
    await more(hook, empty('c3'))
    await more(hook, empty('c4'))
    expect(hook.result.current.results.spotify).toMatchObject({ paused: true, emptyPages: 3 })
  })

  it('starts afresh with the next search', async () => {
    const hook = await started(empty('c2'))
    await more(hook, empty('c3'))
    api.searchTracks.mockResolvedValueOnce(page('spotify', [1], 'n2'))
    act(() => hook.result.current.search('other', ['spotify']))
    await waitFor(() => expect(hook.result.current.results.spotify?.status).toBe('ready'))
    expect(hook.result.current.results.spotify).toMatchObject({ paused: false, emptyPages: 0 })
  })
})
