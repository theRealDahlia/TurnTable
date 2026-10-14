// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Track, TrackPage } from '@shared/types'
import { useArtistSongs, type Artist } from './useArtistSongs'

const song = (id: string, artists: string[]): Track => ({ id, providerId: 'tidal', title: `Song ${id}`, artists, durationMs: 1000 })

let searchTracks: ReturnType<typeof vi.fn>

beforeEach(() => {
  searchTracks = vi.fn()
  Object.assign(window, { turntable: { searchTracks } })
})

const deferred = (): { promise: Promise<TrackPage>; resolve: (page: TrackPage) => void; reject: (error: Error) => void } => {
  let resolve!: (page: TrackPage) => void
  let reject!: (error: Error) => void
  const promise = new Promise<TrackPage>((ok, fail) => ((resolve = ok), (reject = fail)))
  return { promise, resolve, reject }
}

const ARTIST: Artist = { providerId: 'tidal', name: 'Foo Fighters' }

describe('useArtistSongs', () => {
  it("searches the artist's own service for their name, and keeps only songs credited to them", async () => {
    searchTracks.mockResolvedValue({ tracks: [song('1', ['Foo Fighters']), song('2', ['Foo Fighters Tribute Band']), song('3', ['Someone', 'foo fighters'])] })
    const { result } = renderHook(() => useArtistSongs(ARTIST, true))

    expect(result.current.status).toBe('loading')
    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(searchTracks).toHaveBeenCalledExactlyOnceWith('tidal', 'Foo Fighters')
    expect(result.current.tracks.map((t) => t.id)).toEqual(['1', '3'])
    expect(result.current.hasMore).toBe(false)
  })

  it('searches nothing for a service that cannot be searched', () => {
    const { result } = renderHook(() => useArtistSongs(ARTIST, false))
    expect(result.current.status).toBe('idle')
    expect(result.current.tracks).toEqual([])
    expect(searchTracks).not.toHaveBeenCalled()
  })

  it('looks further only when asked, adding new matches and skipping ones already listed', async () => {
    searchTracks
      .mockResolvedValueOnce({ tracks: [song('1', ['Foo Fighters'])], nextCursor: 'page-2' })
      .mockResolvedValueOnce({ tracks: [song('1', ['Foo Fighters']), song('4', ['Foo Fighters']), song('5', ['Other'])] })
    const { result } = renderHook(() => useArtistSongs(ARTIST, true))
    await waitFor(() => expect(result.current.hasMore).toBe(true))
    expect(searchTracks).toHaveBeenCalledOnce()

    act(() => result.current.loadMore())
    expect(result.current.loadingMore).toBe(true)
    await waitFor(() => expect(result.current.loadingMore).toBe(false))

    expect(searchTracks).toHaveBeenLastCalledWith('tidal', 'Foo Fighters', 'page-2')
    expect(result.current.tracks.map((t) => t.id)).toEqual(['1', '4'])
    expect(result.current.hasMore).toBe(false)
  })

  it('keeps the songs found when looking further fails, and says why', async () => {
    searchTracks.mockResolvedValueOnce({ tracks: [song('1', ['Foo Fighters'])], nextCursor: 'page-2' }).mockRejectedValueOnce(new Error('Too many requests'))
    const { result } = renderHook(() => useArtistSongs(ARTIST, true))
    await waitFor(() => expect(result.current.hasMore).toBe(true))

    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.moreError).toBe('Too many requests'))

    expect(result.current.tracks.map((t) => t.id)).toEqual(['1'])
    expect(result.current.hasMore).toBe(true)
  })

  it('shows a failed search with a way to try again', async () => {
    searchTracks.mockRejectedValueOnce(new Error('TIDAL is unavailable')).mockResolvedValueOnce({ tracks: [song('1', ['Foo Fighters'])] })
    const { result } = renderHook(() => useArtistSongs(ARTIST, true))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toBe('TIDAL is unavailable')

    act(() => result.current.retry())
    expect(result.current.status).toBe('loading')
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.tracks).toHaveLength(1)
  })

  it('drops a late answer about the previous artist', async () => {
    const first = deferred()
    searchTracks.mockReturnValueOnce(first.promise).mockResolvedValueOnce({ tracks: [song('9', ['Nirvana'])] })
    const { result, rerender } = renderHook(({ artist }) => useArtistSongs(artist, true), { initialProps: { artist: ARTIST } })

    rerender({ artist: { providerId: 'tidal', name: 'Nirvana' } })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    await act(async () => first.resolve({ tracks: [song('1', ['Foo Fighters'])] }))

    expect(result.current.tracks.map((t) => t.id)).toEqual(['9'])
  })
})
