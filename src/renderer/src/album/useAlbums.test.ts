// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Album, Track } from '@shared/types'
import { useAlbumTracks, MAX_ALBUM_PAGES } from './useAlbumTracks'
import { useArtistAlbums } from './useArtistAlbums'

const album = (id: string, overrides: Partial<Album> = {}): Album => ({ id, providerId: 'tidal', title: `Album ${id}`, artists: ['Foo Fighters'], artworkUrl: 'https://img/cover.jpg', ...overrides })
const track = (id: string, overrides: Partial<Track> = {}): Track => ({ id, providerId: 'tidal', title: `Song ${id}`, artists: ['Foo Fighters'], durationMs: 1000, ...overrides })

let api: { getArtistAlbums: ReturnType<typeof vi.fn>; getAlbumTracks: ReturnType<typeof vi.fn> }
beforeEach(() => {
  api = { getArtistAlbums: vi.fn(), getAlbumTracks: vi.fn() }
  Object.assign(window, { turntable: api })
})

describe('useArtistAlbums', () => {
  it("fetches the artist's first page of albums, and more only when asked, without repeats", async () => {
    api.getArtistAlbums.mockResolvedValueOnce({ albums: [album('1'), album('2')], nextCursor: 'c2' }).mockResolvedValueOnce({ albums: [album('2'), album('3')] })
    const { result } = renderHook(() => useArtistAlbums('tidal', 'a1', true))
    expect(result.current.status).toBe('loading')
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(api.getArtistAlbums).toHaveBeenCalledExactlyOnceWith('tidal', 'a1')

    act(() => result.current.loadMore())
    await waitFor(() => expect(result.current.hasMore).toBe(false))

    expect(api.getArtistAlbums).toHaveBeenLastCalledWith('tidal', 'a1', 'c2')
    expect(result.current.albums.map((a) => a.id)).toEqual(['1', '2', '3'])
  })

  it("asks nothing when the service has no albums or the artist's id is unknown", () => {
    expect(renderHook(() => useArtistAlbums('tidal', undefined, true)).result.current.status).toBe('idle')
    expect(renderHook(() => useArtistAlbums('tidal', 'a1', false)).result.current.status).toBe('idle')
    expect(api.getArtistAlbums).not.toHaveBeenCalled()
  })

  it('shows a failure, and tries again on request', async () => {
    api.getArtistAlbums.mockRejectedValueOnce(new Error('TIDAL is down')).mockResolvedValueOnce({ albums: [album('1')] })
    const { result } = renderHook(() => useArtistAlbums('tidal', 'a1', true))
    await waitFor(() => expect(result.current.error).toBe('TIDAL is down'))

    act(() => result.current.retry())
    await waitFor(() => expect(result.current.albums).toHaveLength(1))
  })
})

describe('useAlbumTracks', () => {
  it('fetches every page of the album, filling in its title and cover where a track leaves them out', async () => {
    api.getAlbumTracks.mockResolvedValueOnce({ tracks: [track('1')], nextCursor: 'p2' }).mockResolvedValueOnce({ tracks: [track('2', { artworkUrl: 'https://img/own.jpg', album: 'Own' })] })
    const { result } = renderHook(() => useAlbumTracks(album('9')))
    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(api.getAlbumTracks.mock.calls).toEqual([
      ['tidal', '9', undefined],
      ['tidal', '9', 'p2']
    ])
    expect(result.current.tracks.map((t) => [t.id, t.album, t.albumId, t.artworkUrl])).toEqual([
      ['1', 'Album 9', '9', 'https://img/cover.jpg'],
      ['2', 'Own', '9', 'https://img/own.jpg']
    ])
  })

  it('stops after a sensible number of pages', async () => {
    api.getAlbumTracks.mockImplementation(async () => ({ tracks: [track(String(Math.random()))], nextCursor: 'more' }))
    const { result } = renderHook(() => useAlbumTracks(album('9')))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(api.getAlbumTracks).toHaveBeenCalledTimes(MAX_ALBUM_PAGES)
  })

  it('fetches nothing for an album it is told not to', () => {
    const { result } = renderHook(() => useAlbumTracks(album('9', { providerId: 'local' }), false))
    expect(result.current.status).toBe('ready')
    expect(api.getAlbumTracks).not.toHaveBeenCalled()
  })

  it('shows a failure, and tries again on request', async () => {
    api.getAlbumTracks.mockRejectedValueOnce(new Error('Not found')).mockResolvedValueOnce({ tracks: [track('1')] })
    const { result } = renderHook(() => useAlbumTracks(album('9')))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toBe('Not found')

    act(() => result.current.retry())
    await waitFor(() => expect(result.current.tracks).toHaveLength(1))
  })
})
