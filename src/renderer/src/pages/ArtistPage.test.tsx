// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderId, ProviderStatus, Track } from '@shared/types'
import { QOBUZ_NOTICE } from '@shared/qobuz'
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
const QOBUZ = provider('qobuz', 'Qobuz')
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
    providers: [TIDAL, SPOTIFY, QOBUZ, LOCAL],
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
beforeEach(() => {
  searchTracks = vi.fn().mockResolvedValue({ tracks: [] })
  Object.assign(window, { turntable: { searchTracks } })
})
afterEach(cleanup)

const show = ({
  name = 'Foo Fighters',
  service = TIDAL,
  library = makeLibrary([]),
  player = makePlayer(),
  onBack = vi.fn(),
  onOpenArtist = vi.fn(),
  backLabel = 'Library'
}: Partial<{ name: string; service: ProviderStatus; library: Library; player: Player; onBack: () => void; onOpenArtist: () => void; backLabel: string }> = {}) => {
  render(
    <ArtistPage
      artist={{ providerId: service.id, name }}
      provider={service}
      library={library}
      player={player}
      backLabel={backLabel}
      onBack={onBack}
      onOpenArtist={onOpenArtist}
    />
  )
  return { player, onBack, onOpenArtist }
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

  it("shows Qobuz's notice on a Qobuz artist, as its terms require", async () => {
    show({ service: QOBUZ, library: makeLibrary([], []) })
    expect(screen.getByText(QOBUZ_NOTICE)).toBeTruthy()
    await waitFor(() => expect(searchTracks).toHaveBeenCalled())
  })
})
