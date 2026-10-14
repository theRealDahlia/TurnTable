// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Album, ProviderId, ProviderStatus, Track } from '@shared/types'
import type { Library } from '../library/useLibrary'
import type { Player } from '../player/usePlayer'
import { localAlbums } from '../album/localAlbums'
import { AlbumPage } from './AlbumPage'

const provider = (id: ProviderId, name: string): ProviderStatus => ({ id, name, authKind: 'oauth-pkce', playback: 'sdk', maxQuality: { codec: 'flac', lossless: true }, connected: true, searchable: true, albums: true })
const TIDAL = provider('tidal', 'TIDAL')
const SPOTIFY = provider('spotify', 'Spotify')
const LOCAL = provider('local', 'Local files')

const ALBUM: Album = {
  id: '58990486',
  providerId: 'tidal',
  title: 'The Colour and the Shape',
  artists: ['Foo Fighters'],
  artistIds: ['a1'],
  artworkUrl: 'https://img/cover.jpg',
  releaseDate: '1997-05-20',
  kind: 'album',
  url: 'https://tidal.com/browse/album/58990486'
}
const song = (id: string, overrides: Partial<Track> = {}): Track => ({ id, providerId: 'tidal', title: `Song ${id}`, artists: ['Foo Fighters'], artistIds: ['a1'], durationMs: 120_000, ...overrides })

const library = (tracks: Track[] = []): Library => ({ listing: false, providers: [], libraries: {}, tracks, loading: false, refreshing: false, reload: vi.fn(), refresh: vi.fn(), refreshProvider: vi.fn(), ensure: vi.fn(), noteSaved: vi.fn(), retry: vi.fn() }) as unknown as Library

function makePlayer(overrides: Partial<Player> = {}): Player {
  return { status: 'idle', currentTime: 0, duration: 0, volume: 1, hasNext: false, hasPrevious: false, play: vi.fn(), toggle: vi.fn(), pause: vi.fn(), next: vi.fn(), previous: vi.fn(), seek: vi.fn(), setVolume: vi.fn(), setShuffle: vi.fn(), clear: vi.fn(), shuffle: false, ...overrides }
}

let getAlbumTracks: ReturnType<typeof vi.fn>
beforeEach(() => {
  getAlbumTracks = vi.fn().mockResolvedValue({ tracks: [song('1'), song('2'), song('3')] })
  Object.assign(window, { turntable: { getAlbumTracks } })
})
afterEach(cleanup)

const show = ({ album = ALBUM, service = TIDAL, lib = library(), player = makePlayer(), onBack = vi.fn(), onOpenArtist = vi.fn() } = {}) => {
  render(<AlbumPage album={album} provider={service} library={lib} player={player} backLabel="Foo Fighters" onBack={onBack} onOpenArtist={onOpenArtist} />)
  return { player, onBack, onOpenArtist }
}
const titles = (): string[] => within(screen.getByRole('list', { name: `Tracks on ${ALBUM.title}` })).getAllByRole('listitem').map((row) => row.querySelector('.track-title')?.textContent ?? '')

describe('AlbumPage', () => {
  it('shows the cover, title, artist, year, and the length once the tracks are in', async () => {
    show()
    expect(screen.getByRole('heading', { level: 1, name: 'The Colour and the Shape' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Cover of The Colour and the Shape' }).getAttribute('src')).toBe('https://img/cover.jpg')
    expect(screen.getByText('Album on TIDAL')).toBeTruthy()
    expect(screen.getByText('1997')).toBeTruthy()
    expect(await screen.findByText('3 songs, 6 min')).toBeTruthy()
  })

  it("lists the album's tracks in order, fetched from its service", async () => {
    show()
    await waitFor(() => expect(titles()).toEqual(['Song 1', 'Song 2', 'Song 3']))
    expect(getAlbumTracks).toHaveBeenCalledExactlyOnceWith('tidal', '58990486', undefined)
  })

  it('plays the whole album in order from the first track, turning shuffle off', async () => {
    const { player } = show()
    await screen.findByRole('list', { name: `Tracks on ${ALBUM.title}` })

    await userEvent.click(screen.getByRole('button', { name: 'Play' }))

    expect(player.setShuffle).toHaveBeenCalledWith(false)
    const [first, queue] = (player.play as ReturnType<typeof vi.fn>).mock.calls[0] as [Track, Track[]]
    expect(first.id).toBe('1')
    expect(queue.map((t) => t.id)).toEqual(['1', '2', '3'])
  })

  it('shuffles the album', async () => {
    const { player } = show()
    await screen.findByRole('list', { name: `Tracks on ${ALBUM.title}` })
    await userEvent.click(screen.getByRole('button', { name: 'Shuffle' }))
    expect(player.setShuffle).toHaveBeenCalledWith(true)
    expect((player.play as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]).toHaveLength(3)
  })

  it('plays one track with the album as the queue', async () => {
    const { player } = show()
    await userEvent.click(await screen.findByRole('button', { name: 'Play Song 2' }))
    const [picked, queue] = (player.play as ReturnType<typeof vi.fn>).mock.calls[0] as [Track, Track[]]
    expect(picked.id).toBe('2')
    expect(queue).toHaveLength(3)
  })

  it("opens the album's artist, with their id on the service", async () => {
    const { onOpenArtist } = show()
    await userEvent.click(within(document.querySelector('.album-byline') as HTMLElement).getByRole('button', { name: 'Foo Fighters' }))
    expect(onOpenArtist).toHaveBeenCalledExactlyOnceWith({ providerId: 'tidal', name: 'Foo Fighters', id: 'a1' })
  })

  it('goes back', async () => {
    const { onBack } = show()
    await userEvent.click(screen.getByRole('button', { name: 'Back to Foo Fighters' }))
    expect(onBack).toHaveBeenCalledOnce()
    await waitFor(() => expect(getAlbumTracks).toHaveBeenCalled())
  })

  it('shows a failure with a way to try again', async () => {
    getAlbumTracks.mockRejectedValueOnce(new Error('Album not found')).mockResolvedValueOnce({ tracks: [song('1')] })
    show()
    expect((await screen.findByRole('alert')).textContent).toContain('TIDAL: Album not found')
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(titles()).toEqual(['Song 1']))
  })

  it('links to the album on its service, and credits Spotify with its logo on a Spotify album', async () => {
    show()
    expect(screen.getByRole('link', { name: 'Open in TIDAL' }).getAttribute('href')).toBe(ALBUM.url)
    cleanup()
    getAlbumTracks.mockResolvedValue({ tracks: [song('1', { providerId: 'spotify' })] })
    show({ album: { ...ALBUM, providerId: 'spotify', url: 'https://open.spotify.com/album/x' }, service: SPOTIFY })
    expect(screen.getByRole('link', { name: 'Open Spotify' }).getAttribute('href')).toBe('https://open.spotify.com/album/x')
    expect(document.querySelector('.spotify-credit img[alt="Spotify logo"]')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Open in Spotify' })).toBeNull()
    await waitFor(() => expect(getAlbumTracks).toHaveBeenCalledTimes(2))
  })

  it('plays a local album from the files already loaded, fetching nothing', async () => {
    const files = [
      song('b', { providerId: 'local', album: 'Demos', trackNumber: 2, artistIds: undefined }),
      song('a', { providerId: 'local', album: 'Demos', trackNumber: 1, artistIds: undefined })
    ]
    const [demos] = localAlbums(files, 'Foo Fighters')
    const { player } = show({ album: demos!, service: LOCAL, lib: library(files) })

    await userEvent.click(screen.getByRole('button', { name: 'Play' }))

    expect(getAlbumTracks).not.toHaveBeenCalled()
    expect(((player.play as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as Track[]).map((t) => t.id)).toEqual(['a', 'b'])
  })
})
