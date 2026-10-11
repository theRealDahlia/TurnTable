// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderId, ProviderStatus, Track } from '@shared/types'
import type { Library, ProviderLibrary } from '../library/useLibrary'
import type { Player } from '../player/usePlayer'
import { LibraryPage } from './LibraryPage'

const provider = (id: ProviderId, name: string, connected: boolean): ProviderStatus => ({
  id,
  name,
  authKind: 'oauth-pkce',
  playback: 'sdk',
  maxQuality: { codec: 'aac', lossless: false },
  connected
})

const track = (providerId: ProviderId, n: number, overrides: Partial<Track> = {}): Track => ({
  id: `${providerId}-${n}`,
  providerId,
  title: `Song ${n}`,
  artists: [`Artist ${n}`],
  album: `Album ${n}`,
  durationMs: 185_000,
  savedAt: `2026-01-${String(n).padStart(2, '0')}T00:00:00Z`,
  ...overrides
})

function makeLibrary(overrides: Partial<Library> = {}, tracks: Track[] = []): Library {
  const providers = [provider('spotify', 'Spotify', true), provider('qobuz', 'Qobuz', true), provider('soundcloud', 'SoundCloud', false)]
  const libraries: Partial<Record<ProviderId, ProviderLibrary>> = {}
  for (const p of providers.filter((x) => x.connected)) {
    libraries[p.id] = { status: 'ready', tracks: tracks.filter((t) => t.providerId === p.id) }
  }
  return {
    listing: false,
    providers,
    libraries,
    tracks,
    loading: false,
    reload: vi.fn(),
    refreshProvider: vi.fn(),
    retry: vi.fn(),
    ...overrides
  }
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
    ...overrides
  }
}

const rows = (): HTMLElement[] => within(screen.getByRole('list', { name: 'Saved tracks' })).queryAllByRole('listitem')
const titles = (): (string | null)[] => rows().map((row) => row.querySelector('.track-title')!.textContent)

afterEach(cleanup)

describe('LibraryPage', () => {
  const sample = [track('spotify', 1), track('spotify', 2), track('qobuz', 3, { title: 'Café Noir', artists: ['Zoë'] })]

  it('lists tracks with title, artists, album, service logo and duration', () => {
    render(<LibraryPage library={makeLibrary({}, sample)} player={makePlayer()} onOpenConnections={vi.fn()} />)

    expect(rows()).toHaveLength(3)
    const first = rows().find((row) => row.textContent?.includes('Song 1'))!
    expect(within(first).getByText('Artist 1')).toBeTruthy()
    expect(within(first).getByText('Album 1')).toBeTruthy()
    expect(within(first).getByText('3:05')).toBeTruthy()
    expect(within(first).getByRole('img', { name: 'Spotify logo' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('3 tracks')
  })

  it('shows newest saved first by default and re-sorts on request', async () => {
    render(<LibraryPage library={makeLibrary({}, sample)} player={makePlayer()} onOpenConnections={vi.fn()} />)
    expect(titles()).toEqual(['Café Noir', 'Song 2', 'Song 1'])

    await userEvent.selectOptions(screen.getByRole('combobox'), 'title')
    expect(titles()).toEqual(['Café Noir', 'Song 1', 'Song 2'])

    await userEvent.selectOptions(screen.getByRole('combobox'), 'artist')
    expect(titles()).toEqual(['Song 1', 'Song 2', 'Café Noir'])
  })

  it('searches across title, artist and album ignoring accents, and says when nothing matches', async () => {
    render(<LibraryPage library={makeLibrary({}, sample)} player={makePlayer()} onOpenConnections={vi.fn()} />)
    const search = screen.getByRole('searchbox', { name: 'Search your library' })

    await userEvent.type(search, 'zoe')
    expect(titles()).toEqual(['Café Noir'])
    expect(screen.getByRole('status').textContent).toBe('1 track found')

    await userEvent.clear(search)
    await userEvent.type(search, 'nothing like this')
    expect(rows()).toHaveLength(0)
    expect(screen.getByText('No tracks match your search.')).toBeTruthy()
  })

  it('filters by service and shows per-service counts, only for connected services', async () => {
    render(<LibraryPage library={makeLibrary({}, sample)} player={makePlayer()} onOpenConnections={vi.fn()} />)
    const filters = within(screen.getByRole('group', { name: 'Filter by service' }))

    expect(filters.getByRole('button', { name: /^All\s*3$/ })).toBeTruthy()
    expect(filters.getByRole('button', { name: /^Spotify\s*2$/ })).toBeTruthy()
    expect(filters.queryByRole('button', { name: /SoundCloud/ })).toBeNull()

    await userEvent.click(filters.getByRole('button', { name: /^Qobuz/ }))
    expect(titles()).toEqual(['Café Noir'])
    expect(filters.getByRole('button', { name: /^Qobuz/ }).getAttribute('aria-pressed')).toBe('true')

    await userEvent.click(filters.getByRole('button', { name: /^All/ }))
    expect(rows()).toHaveLength(3)
  })

  it('renders in chunks and reveals more on request', async () => {
    const many = Array.from({ length: 450 }, (_, i) => track('spotify', i + 1, { savedAt: undefined }))
    render(<LibraryPage library={makeLibrary({}, many)} player={makePlayer()} onOpenConnections={vi.fn()} />)

    expect(rows()).toHaveLength(200)
    await userEvent.click(screen.getByRole('button', { name: 'Show more (250 remaining)' }))
    expect(rows()).toHaveLength(400)
    await userEvent.click(screen.getByRole('button', { name: 'Show more (50 remaining)' }))
    expect(rows()).toHaveLength(450)
    expect(screen.queryByRole('button', { name: /Show more/ })).toBeNull()
  })

  it('shows progress while services are still loading', () => {
    const library = makeLibrary({ loading: true }, sample)
    render(<LibraryPage library={library} player={makePlayer()} onOpenConnections={vi.fn()} />)

    expect(screen.getByRole('status').textContent).toBe('Loading your library… 3 tracks so far')
  })

  it('invites the user to connect a service when none is connected', async () => {
    const onOpenConnections = vi.fn()
    const library = makeLibrary({ providers: [provider('spotify', 'Spotify', false)], libraries: {} })
    render(<LibraryPage library={library} player={makePlayer()} onOpenConnections={onOpenConnections} />)

    expect(screen.getByText('No services connected')).toBeTruthy()
    expect(screen.queryByRole('searchbox')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Go to Connections' }))
    expect(onOpenConnections).toHaveBeenCalledOnce()
  })

  it('does not flash the empty invitation while still checking connections', () => {
    render(<LibraryPage library={makeLibrary({ listing: true, providers: [], libraries: {} })} player={makePlayer()} onOpenConnections={vi.fn()} />)
    expect(screen.queryByText('No services connected')).toBeNull()
  })

  it('explains an empty library on connected services', () => {
    render(<LibraryPage library={makeLibrary()} player={makePlayer()} onOpenConnections={vi.fn()} />)
    expect(screen.getByText('No saved tracks found on your connected services.')).toBeTruthy()
  })

  it('shows a per-service error with a retry that targets that service', async () => {
    const library = makeLibrary({}, [track('qobuz', 3)])
    library.libraries.spotify = { status: 'error', tracks: [], error: 'Spotify request failed with status 500' }
    render(<LibraryPage library={library} player={makePlayer()} onOpenConnections={vi.fn()} />)

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('Spotify: Spotify request failed with status 500')
    await userEvent.click(screen.getByRole('button', { name: 'Retry Spotify' }))
    expect(library.retry).toHaveBeenCalledWith('spotify')
    // The other service's tracks are still shown.
    expect(titles()).toEqual(['Song 3'])
  })

  it('offers to retry when connections could not be checked', async () => {
    const library = makeLibrary({ error: 'no bridge', providers: [], libraries: {} })
    render(<LibraryPage library={library} player={makePlayer()} onOpenConnections={vi.fn()} />)

    expect(screen.getByRole('alert').textContent).toContain('no bridge')
    expect(screen.queryByText('No services connected')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(library.reload).toHaveBeenCalledOnce()
  })

  it('links the service logo back to the track on its service when a link is known', () => {
    const linked = [
      track('spotify', 1, { url: 'https://open.spotify.com/track/abc' }),
      track('qobuz', 2) // no link known
    ]
    render(<LibraryPage library={makeLibrary({}, linked)} player={makePlayer()} onOpenConnections={vi.fn()} />)

    const link = screen.getByRole('link', { name: 'Open Song 1 on Spotify' })
    expect(link.getAttribute('href')).toBe('https://open.spotify.com/track/abc')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noreferrer')
    expect(within(link).getByRole('img', { name: 'Spotify logo' })).toBeTruthy()
    // Only the tracks with a known link get one.
    expect(screen.getAllByRole('link')).toHaveLength(1)
  })

  describe('playing', () => {
    const local = (n: number, overrides: Partial<Track> = {}): Track =>
      track('local', n, { quality: { codec: 'flac', lossless: true, bitDepth: 24, sampleRateHz: 96000 }, ...overrides })
    const library = (tracks: Track[]): Library => {
      const lib = makeLibrary({}, tracks)
      lib.providers = [...lib.providers, provider('local', 'Local files', true)]
      return lib
    }

    it('plays a track with the visible list, in the order shown, as the queue', async () => {
      const player = makePlayer()
      const tracks = [local(1), local(2), local(3)]
      render(<LibraryPage library={library(tracks)} player={player} onOpenConnections={vi.fn()} />)
      await userEvent.selectOptions(screen.getByRole('combobox'), 'title')

      await userEvent.click(screen.getByRole('button', { name: 'Play Song 2' }))

      expect(player.play).toHaveBeenCalledOnce()
      const [played, queue] = (player.play as ReturnType<typeof vi.fn>).mock.calls[0] as [Track, Track[]]
      expect(played.title).toBe('Song 2')
      expect(queue.map((t) => t.title)).toEqual(['Song 1', 'Song 2', 'Song 3'])
    })

    it('queues only what the current search matches', async () => {
      const player = makePlayer()
      render(<LibraryPage library={library([local(1), local(2), local(3)])} player={player} onOpenConnections={vi.fn()} />)
      await userEvent.type(screen.getByRole('searchbox'), 'Song 3')
      await userEvent.click(screen.getByRole('button', { name: 'Play Song 3' }))

      const [, queue] = (player.play as ReturnType<typeof vi.fn>).mock.calls[0] as [Track, Track[]]
      expect(queue.map((t) => t.title)).toEqual(['Song 3'])
    })

    it('plays on double-click', async () => {
      const player = makePlayer()
      render(<LibraryPage library={library([local(1)])} player={player} onOpenConnections={vi.fn()} />)
      await userEvent.dblClick(rows()[0]!)
      expect(player.play).toHaveBeenCalledOnce()
    })

    it('pauses and resumes the current track instead of restarting it', async () => {
      const current = local(1)
      const player = makePlayer({ track: current, status: 'playing' })
      render(<LibraryPage library={library([current, local(2)])} player={player} onOpenConnections={vi.fn()} />)

      await userEvent.click(screen.getByRole('button', { name: 'Pause Song 1' }))

      expect(player.toggle).toHaveBeenCalledOnce()
      expect(player.play).not.toHaveBeenCalled()
      expect(screen.getByRole('button', { name: 'Play Song 2' })).toBeTruthy()
      const currentRow = rows().find((row) => row.textContent?.includes('Song 1'))!
      expect(currentRow.getAttribute('data-current')).toBe('true')
    })

    it.each([
      ['an ALAC file', local(1, { quality: { codec: 'alac', lossless: true } }), /ALAC files can't be played/],
      ['a Qobuz track (playback not built yet)', track('qobuz', 2), /not available yet/],
      ['a Spotify track without a valid id', track('spotify', 3), /Spotify track can't be played/]
    ])('disables Play for %s and says why', async (_label, unplayable, reason) => {
      const player = makePlayer()
      render(<LibraryPage library={library([unplayable])} player={player} onOpenConnections={vi.fn()} />)

      const button = screen.getByRole('button', { name: `Play ${unplayable.title}` }) as HTMLButtonElement
      expect(button.disabled).toBe(true)
      expect(button.title).toMatch(reason)
      await userEvent.dblClick(rows()[0]!)
      expect(player.play).not.toHaveBeenCalled()
    })

    it('lets a Spotify track with a valid id be played, alongside local files in one queue', async () => {
      const player = makePlayer()
      const spotifyTrack = track('spotify', 2, { id: '4iV5W9uYEdYUVa79Axb7Rh', title: 'Spotify Song' })
      render(<LibraryPage library={library([local(1), spotifyTrack])} player={player} onOpenConnections={vi.fn()} />)

      const button = screen.getByRole('button', { name: 'Play Spotify Song' }) as HTMLButtonElement
      expect(button.disabled).toBe(false)
      await userEvent.click(button)

      const [played, queue] = (player.play as ReturnType<typeof vi.fn>).mock.calls[0] as [Track, Track[]]
      expect(played.id).toBe('4iV5W9uYEdYUVa79Axb7Rh')
      expect(queue.map((t) => t.providerId).sort()).toEqual(['local', 'spotify'])
    })

    it('shows the audio format of each track that has one', () => {
      render(<LibraryPage library={library([local(1)])} player={makePlayer()} onOpenConnections={vi.fn()} />)
      expect(within(rows()[0]!).getByText('FLAC · 24-bit / 96 kHz')).toBeTruthy()
    })
  })

  it('handles tracks without artwork or album', () => {
    const bare = [track('spotify', 1, { album: undefined, artworkUrl: undefined })]
    render(<LibraryPage library={makeLibrary({}, bare)} player={makePlayer()} onOpenConnections={vi.fn()} />)
    expect(rows()).toHaveLength(1)
    expect(rows()[0]!.querySelector('img.track-art')).toBeNull()
  })
})
