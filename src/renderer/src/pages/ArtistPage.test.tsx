// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Album, ProviderId, ProviderStatus, Track } from '@shared/types'
import type { Library } from '../library/useLibrary'
import type { Player } from '../player/usePlayer'
import { ArtistPage } from './ArtistPage'

const provider = (id: ProviderId, name: string, extra: Partial<ProviderStatus> = {}): ProviderStatus => ({
  id,
  name,
  authKind: 'oauth-pkce',
  playback: 'sdk',
  maxQuality: { codec: 'aac', lossless: false },
  connected: true,
  searchable: id !== 'local',
  ...extra
})

const TIDAL = provider('tidal', 'TIDAL')
const SPOTIFY = provider('spotify', 'Spotify')
const LOCAL = provider('local', 'Local files', { authKind: 'none', playback: 'file' })

const song = (providerId: ProviderId, id: string, artists = ['Foo Fighters']): Track => ({
  id: providerId === 'spotify' ? id.padEnd(22, 'x') : id,
  providerId,
  title: `Song ${id}`,
  artists,
  durationMs: 200_000
})

function makeLibrary(tracks: Track[], loaded: ProviderId[] = ['tidal']): Library {
  return {
    listing: false,
    providers: [TIDAL, SPOTIFY, LOCAL],
    libraries: Object.fromEntries(loaded.map((id) => [id, { status: 'ready', tracks: tracks.filter((t) => t.providerId === id) }])),
    tracks,
    loading: false,
    refreshing: false,
    reload: vi.fn(),
    refresh: vi.fn(),
    refreshProvider: vi.fn(),
    ensure: vi.fn(),
    noteSaved: vi.fn(),
    retry: vi.fn()
  } as unknown as Library
}

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    status: 'idle',
    currentTime: 0,
    duration: 0,
    volume: 1,
    hasNext: false,
    hasPrevious: false,
    play: vi.fn(),
    toggle: vi.fn(),
    pause: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    setShuffle: vi.fn(),
    clear: vi.fn(),
    shuffle: false,
    ...overrides
  }
}

let searchTracks: ReturnType<typeof vi.fn>
let getArtistAlbums: ReturnType<typeof vi.fn>
beforeEach(() => {
  searchTracks = vi.fn().mockResolvedValue({ tracks: [] })
  getArtistAlbums = vi.fn().mockResolvedValue({ albums: [] })
  Object.assign(window, { turntable: { searchTracks, getArtistAlbums } })
})
afterEach(cleanup)

const show = ({
  name = 'Foo Fighters',
  service = TIDAL,
  library = makeLibrary([]),
  player = makePlayer(),
  onBack = vi.fn(),
  onOpenArtist = vi.fn(),
  onOpenAlbum = vi.fn(),
  backLabel = 'Library',
  id
}: Partial<{ name: string; service: ProviderStatus; library: Library; player: Player; onBack: () => void; onOpenArtist: () => void; onOpenAlbum: () => void; backLabel: string; id: string }> = {}) => {
  render(
    <ArtistPage
      artist={{ providerId: service.id, name, ...(id ? { id } : {}) }}
      provider={service}
      library={library}
      player={player}
      backLabel={backLabel}
      onBack={onBack}
      onOpenArtist={onOpenArtist}
      onOpenAlbum={onOpenAlbum}
    />
  )
  return { player, onBack, onOpenArtist, onOpenAlbum }
}
const titlesIn = (name: string): string[] => within(screen.getByRole('list', { name })).getAllByRole('listitem').map((row) => row.querySelector('.track-title')?.textContent ?? '')

describe('ArtistPage', () => {
  it("is headed with the artist's name and their service", async () => {
    show()
    expect(screen.getByRole('heading', { level: 1, name: 'Foo Fighters' })).toBeTruthy()
    expect(screen.getByText('Artist on TIDAL')).toBeTruthy()
    await waitFor(() => expect(searchTracks).toHaveBeenCalled())
  })

  it('goes back to where it was opened from', async () => {
    const { onBack } = show({ backLabel: 'Search' })
    await userEvent.click(screen.getByRole('button', { name: 'Back to Search' }))
    expect(onBack).toHaveBeenCalledOnce()
  })

  it("lists the artist's songs in your library on that service only, then the rest the service finds", async () => {
    const library = makeLibrary([song('tidal', 'a'), song('tidal', 'b', ['Nirvana']), song('spotify', 'c'), song('local', 'd')])
    searchTracks.mockResolvedValue({ tracks: [song('tidal', 'a'), song('tidal', 'e'), song('tidal', 'f', ['Foo Fighters Tribute'])] })
    show({ library })

    expect(titlesIn('Foo Fighters in your library')).toEqual(['Song a'])
    expect(await screen.findByRole('list', { name: 'More by Foo Fighters on TIDAL' })).toBeTruthy()
    // The saved song isn't listed twice, and a different artist with a similar name is left out.
    expect(titlesIn('More by Foo Fighters on TIDAL')).toEqual(['Song e'])
    expect(searchTracks).toHaveBeenCalledExactlyOnceWith('tidal', 'Foo Fighters')
    expect(screen.getByRole('status').textContent).toBe('2 songs · 1 in your library')
  })

  it('plays from each list with that list as the queue', async () => {
    const saved = [song('tidal', 'a'), song('tidal', 'b')]
    const found = [song('tidal', 'e'), song('tidal', 'f')]
    searchTracks.mockResolvedValue({ tracks: found })
    const { player } = show({ library: makeLibrary(saved) })

    await userEvent.click(screen.getByRole('button', { name: 'Play Song b' }))
    expect(player.play).toHaveBeenLastCalledWith(saved[1], saved)

    await userEvent.click(await screen.findByRole('button', { name: 'Play Song f' }))
    expect(player.play).toHaveBeenLastCalledWith(found[1], found)
  })

  it('opens another artist credited on a song', async () => {
    searchTracks.mockResolvedValue({ tracks: [song('tidal', 'e', ['Foo Fighters', 'Brian May'])] })
    const { onOpenArtist } = show()
    await userEvent.click(await screen.findByRole('button', { name: 'Brian May' }))
    expect(onOpenArtist).toHaveBeenCalledExactlyOnceWith({ providerId: 'tidal', name: 'Brian May' })
  })

  it('shows placeholders while searching, and a failure with a way to try again', async () => {
    searchTracks.mockRejectedValueOnce(new Error('TIDAL is unavailable')).mockResolvedValueOnce({ tracks: [song('tidal', 'e')] })
    show()
    expect(document.querySelector('.skeleton-row')).toBeTruthy()

    expect((await screen.findByRole('alert')).textContent).toContain('TIDAL: TIDAL is unavailable')
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByRole('list', { name: 'More by Foo Fighters on TIDAL' })).toBeTruthy()
  })

  it('finds more only when asked', async () => {
    searchTracks.mockResolvedValueOnce({ tracks: [song('tidal', 'e')], nextCursor: 'next' }).mockResolvedValueOnce({ tracks: [song('tidal', 'g')] })
    show()

    await userEvent.click(await screen.findByRole('button', { name: 'Find more' }))

    await waitFor(() => expect(titlesIn('More by Foo Fighters on TIDAL')).toEqual(['Song e', 'Song g']))
    expect(searchTracks).toHaveBeenLastCalledWith('tidal', 'Foo Fighters', 'next')
    expect(screen.queryByRole('button', { name: 'Find more' })).toBeNull()
  })

  it('says when the service has nothing by the artist', async () => {
    show()
    expect(await screen.findByText('No songs by Foo Fighters on TIDAL.')).toBeTruthy()
  })

  it('searches nothing for local files, and shows the ones by the artist', () => {
    show({ service: LOCAL, library: makeLibrary([song('local', 'd'), song('local', 'z', ['Other'])], ['local']) })
    expect(titlesIn('Foo Fighters in your library')).toEqual(['Song d'])
    expect(searchTracks).not.toHaveBeenCalled()
  })

  it('credits Spotify with its logo and a link back on a Spotify artist', async () => {
    searchTracks.mockResolvedValue({ tracks: [song('spotify', 'e')] })
    show({ service: SPOTIFY, library: makeLibrary([], []) })
    expect((await screen.findByRole('link', { name: 'Open Spotify' })).getAttribute('href')).toBe('https://open.spotify.com')
    expect(document.querySelector('.spotify-credit img[alt="Spotify logo"]')).toBeTruthy()
  })

  describe('albums', () => {
    const WITH_ALBUMS = { ...TIDAL, albums: true }
    const album = (id: string): Album => ({ id, providerId: 'tidal', title: `Album ${id}`, artists: ['Foo Fighters'], releaseDate: '1997-05-20', kind: 'album' })
    const shelf = (): HTMLElement => screen.getByRole('list', { name: 'Albums by Foo Fighters' })

    it("lists the artist's albums on their service, and opens the one clicked", async () => {
      getArtistAlbums.mockResolvedValue({ albums: [album('1'), album('2')] })
      const { onOpenAlbum } = show({ service: WITH_ALBUMS, id: 'a1' })

      await waitFor(() => expect(within(shelf()).getAllByRole('listitem')).toHaveLength(2))
      expect(getArtistAlbums).toHaveBeenCalledExactlyOnceWith('tidal', 'a1')

      await userEvent.click(within(shelf()).getByRole('button', { name: /Album 2/ }))
      expect(onOpenAlbum).toHaveBeenCalledExactlyOnceWith(album('2'))
    })

    it("finds the artist's id on a song of theirs when they were opened without one", async () => {
      searchTracks.mockResolvedValue({ tracks: [song('tidal', 'e', ['Guest', 'Foo Fighters'])].map((t) => ({ ...t, artistIds: ['g9', 'a7'] })) })
      show({ service: WITH_ALBUMS })
      await waitFor(() => expect(getArtistAlbums).toHaveBeenCalledExactlyOnceWith('tidal', 'a7'))
    })

    it('shows a failure with a way to try again', async () => {
      getArtistAlbums.mockRejectedValueOnce(new Error('TIDAL is down')).mockResolvedValueOnce({ albums: [album('1')] })
      show({ service: WITH_ALBUMS, id: 'a1' })
      const alert = await screen.findByText('TIDAL: TIDAL is down', { exact: false })
      await userEvent.click(within(alert.closest('.banner') as HTMLElement).getByRole('button', { name: 'Retry' }))
      await waitFor(() => expect(within(shelf()).getAllByRole('listitem')).toHaveLength(1))
    })

    it("has no album row on a service that has no albums", async () => {
      show({ service: TIDAL, id: 'a1' })
      await waitFor(() => expect(searchTracks).toHaveBeenCalled())
      expect(screen.queryByRole('heading', { name: 'Albums' })).toBeNull()
      expect(getArtistAlbums).not.toHaveBeenCalled()
    })

    it('makes albums of local files from their tags, fetching nothing', () => {
      const files = [song('local', 'd', ['Foo Fighters']), song('local', 'e', ['Foo Fighters'])].map((t, i) => ({ ...t, album: i ? 'Wasting Light' : 'Echoes' }))
      show({ service: LOCAL, library: makeLibrary(files, ['local']) })
      expect(within(shelf()).getAllByRole('listitem').map((item) => item.querySelector('.album-title')?.textContent)).toEqual(['Echoes', 'Wasting Light'])
      expect(getArtistAlbums).not.toHaveBeenCalled()
    })
  })
})
