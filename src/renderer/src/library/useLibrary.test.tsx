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
