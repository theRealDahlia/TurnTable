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
    refreshing: false,
    reload: vi.fn(),
    refresh: vi.fn(),
    refreshProvider: vi.fn(),
    ensure: vi.fn(),
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
    setShuffle: vi.fn(),
    clear: vi.fn(),
    shuffle: false,
    ...overrides
  }
}

const rows = (): HTMLElement[] => within(screen.getByRole('list', { name: 'Saved tracks' })).queryAllByRole('listitem')
const titles = (): (string | null)[] => rows().map((row) => row.querySelector('.track-title')!.textContent)

afterEach(cleanup)

describe('LibraryPage', () => {
  const sample = [track('spotify', 1), track('spotify', 2), track('spotify', 3, { title: 'Café Noir', artists: ['Zoë'] })]

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

  it("shows one service's library at a time, starting with the first connected, with no combined view", async () => {
    const mixed = [...sample, track('qobuz', 4, { title: 'Qobuz Song' })]
    render(<LibraryPage library={makeLibrary({}, mixed)} player={makePlayer()} onOpenConnections={vi.fn()} />)
    const filters = within(screen.getByRole('group', { name: 'Filter by service' }))

    expect(filters.queryByRole('button', { name: /^All/ })).toBeNull()
    expect(filters.queryByRole('button', { name: /SoundCloud/ })).toBeNull()
    expect(filters.getByRole('button', { name: /^Spotify\s*3$/ }).getAttribute('aria-pressed')).toBe('true')
    expect(titles()).toEqual(['Café Noir', 'Song 2', 'Song 1'])
    expect(screen.getByRole('status').textContent).toBe('3 tracks')

    await userEvent.click(filters.getByRole('button', { name: /^Qobuz\s*1$/ }))
    expect(titles()).toEqual(['Qobuz Song'])
    expect(filters.getByRole('button', { name: /^Qobuz/ }).getAttribute('aria-pressed')).toBe('true')
    expect(filters.getByRole('button', { name: /^Spotify/ }).getAttribute('aria-pressed')).toBe('false')
  })

  it("asks for a service's library when its tab is shown, and for the next one when it is chosen", async () => {
    const library = makeLibrary({}, sample)
    render(<LibraryPage library={library} player={makePlayer()} onOpenConnections={vi.fn()} />)
    expect(library.ensure).toHaveBeenCalledWith('spotify')
    expect(library.ensure).not.toHaveBeenCalledWith('qobuz')

    await userEvent.click(screen.getByRole('button', { name: /^Qobuz/ }))

    expect(library.ensure).toHaveBeenCalledWith('qobuz')
  })

  it('shows it is loading, not empty, between choosing a service and its first page', () => {
    const library = makeLibrary({}, [])
    delete library.libraries.spotify
    const { container } = render(<LibraryPage library={library} player={makePlayer()} onOpenConnections={vi.fn()} />)

    expect(container.querySelectorAll('.skeleton-row').length).toBeGreaterThan(0)
    expect(screen.queryByText('No saved tracks found on your connected services.')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('Loading your library… 0 tracks so far')
  })

  it('moves to another connected service when the one on show is disconnected', async () => {
    const mixed = [...sample, track('qobuz', 4, { title: 'Qobuz Song' })]
    const { rerender } = render(<LibraryPage library={makeLibrary({}, mixed)} player={makePlayer()} onOpenConnections={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /^Qobuz/ }))
    expect(titles()).toEqual(['Qobuz Song'])

    const providers = [provider('spotify', 'Spotify', true), provider('qobuz', 'Qobuz', false)]
    rerender(<LibraryPage library={makeLibrary({ providers }, sample)} player={makePlayer()} onOpenConnections={vi.fn()} />)

    expect(titles()).toEqual(['Café Noir', 'Song 2', 'Song 1'])
    expect(screen.getByRole('button', { name: /^Spotify/ }).getAttribute('aria-pressed')).toBe('true')
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
    // The other service's tracks are still there when its tab is chosen.
    await userEvent.click(screen.getByRole('button', { name: /^Qobuz/ }))
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
      track('spotify', 2) // no link known
    ]
    render(<LibraryPage library={makeLibrary({}, linked)} player={makePlayer()} onOpenConnections={vi.fn()} />)

    const link = screen.getByRole('link', { name: 'Open Song 1 on Spotify' })
    expect(link.getAttribute('href')).toBe('https://open.spotify.com/track/abc')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noreferrer')
    expect(within(link).getByRole('img', { name: 'Spotify logo' })).toBeTruthy()
    // Only the tracks with a known link get one.
    expect(screen.getAllByRole('link', { name: /^Open .* on / })).toHaveLength(1)
  })

  describe("Spotify's attribution", () => {
    it('credits Spotify with its full logo and a link back below its tracks, and only there', async () => {
      const mixed = [track('spotify', 1), track('qobuz', 2)]
      render(<LibraryPage library={makeLibrary({}, mixed)} player={makePlayer()} onOpenConnections={vi.fn()} />)

      expect(document.querySelector('.spotify-credit img[alt="Spotify logo"]')).toBeTruthy()
      expect(screen.getByRole('link', { name: 'Open Spotify' }).getAttribute('href')).toBe('https://open.spotify.com')

      await userEvent.click(screen.getByRole('button', { name: /^Qobuz/ }))
      expect(screen.queryByRole('link', { name: 'Open Spotify' })).toBeNull()
    })

    it("marks the page with the service on show, so Spotify's rows can be laid out without anything over the artwork", async () => {
      const mixed = [track('spotify', 1), track('qobuz', 2)]
      const { container } = render(<LibraryPage library={makeLibrary({}, mixed)} player={makePlayer()} onOpenConnections={vi.fn()} />)
      expect(container.querySelector('main')!.getAttribute('data-service')).toBe('spotify')
      expect(rows()[0]!.getAttribute('data-provider')).toBe('spotify')

      await userEvent.click(screen.getByRole('button', { name: /^Qobuz/ }))
      expect(container.querySelector('main')!.getAttribute('data-service')).toBe('qobuz')
    })

    it('gives the whole title on hover, as the service wrote it', () => {
      const long = track('spotify', 1, { title: 'A Very Long Title (Remastered 2011)', artists: ['One', 'Two'], album: 'The Album' })
      render(<LibraryPage library={makeLibrary({}, [long])} player={makePlayer()} onOpenConnections={vi.fn()} />)
      expect(screen.getByText('A Very Long Title (Remastered 2011)').getAttribute('title')).toBe('A Very Long Title (Remastered 2011)')
      expect(screen.getByText('One, Two').getAttribute('title')).toBe('One, Two')
      expect(screen.getByText('The Album').getAttribute('title')).toBe('The Album')
    })
  })

  describe('playing', () => {
    const local = (n: number, overrides: Partial<Track> = {}): Track =>
      track('local', n, { quality: { codec: 'flac', lossless: true, bitDepth: 24, sampleRateHz: 96000 }, ...overrides })
    const library = (tracks: Track[]): Library => {
      const lib = makeLibrary({}, tracks)
      lib.providers = [provider('local', 'Local files', true), ...lib.providers]
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

      if (unplayable.providerId !== 'local') await userEvent.click(screen.getByRole('button', { name: new RegExp(`^${unplayable.providerId === 'qobuz' ? 'Qobuz' : 'Spotify'}`) }))
      const button = screen.getByRole('button', { name: `Play ${unplayable.title}` }) as HTMLButtonElement
      expect(button.disabled).toBe(true)
      expect(button.title).toMatch(reason)
      await userEvent.dblClick(rows()[0]!)
      expect(player.play).not.toHaveBeenCalled()
    })

    it("plays a Spotify track with a valid id, queueing only Spotify's tracks, never the local files", async () => {
      const player = makePlayer()
      const spotifyTrack = track('spotify', 2, { id: '4iV5W9uYEdYUVa79Axb7Rh', title: 'Spotify Song' })
      render(<LibraryPage library={library([local(1), spotifyTrack])} player={player} onOpenConnections={vi.fn()} />)
      expect(screen.getByRole('button', { name: 'Play Song 1' })).toBeTruthy()
      await userEvent.click(screen.getByRole('button', { name: /^Spotify/ }))
      expect(screen.queryByRole('button', { name: 'Play Song 1' })).toBeNull()

      const button = screen.getByRole('button', { name: 'Play Spotify Song' }) as HTMLButtonElement
      expect(button.disabled).toBe(false)
      await userEvent.click(button)

      const [played, queue] = (player.play as ReturnType<typeof vi.fn>).mock.calls[0] as [Track, Track[]]
      expect(played.id).toBe('4iV5W9uYEdYUVa79Axb7Rh')
      expect(queue.map((t) => t.providerId)).toEqual(['spotify'])
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

  describe('loading, layout and empty states', () => {
    const sample = [track('spotify', 1), track('spotify', 2)]
    const skeletonRows = (container: HTMLElement): number => container.querySelectorAll('.skeleton-row').length

    it('shows placeholder rows, hidden from assistive technology, while the first tracks load', () => {
      const { container } = render(<LibraryPage library={makeLibrary({ loading: true }, [])} player={makePlayer()} onOpenConnections={vi.fn()} />)

      expect(skeletonRows(container)).toBe(8)
      expect(container.querySelector('.skeleton-row')!.closest('ul')!.getAttribute('aria-hidden')).toBe('true')
      expect(rows()).toHaveLength(0)
      expect(screen.queryByText('No saved tracks found on your connected services.')).toBeNull()
    })

    it('replaces the placeholders as soon as tracks arrive, even while more are loading', () => {
      const { container } = render(<LibraryPage library={makeLibrary({ loading: true }, sample)} player={makePlayer()} onOpenConnections={vi.fn()} />)
      expect(skeletonRows(container)).toBe(0)
      expect(rows()).toHaveLength(2)
    })

    it('does not show placeholders for a search that found nothing', async () => {
      const { container } = render(<LibraryPage library={makeLibrary({ loading: true }, sample)} player={makePlayer()} onOpenConnections={vi.fn()} />)
      await userEvent.type(screen.getByRole('searchbox'), 'zzz')
      expect(skeletonRows(container)).toBe(0)
    })

    it('shows placeholders, and no controls yet, while it is still checking which services are connected', () => {
      const library = makeLibrary({ listing: true, loading: true, providers: [], libraries: {} })
      const { container } = render(<LibraryPage library={library} player={makePlayer()} onOpenConnections={vi.fn()} />)

      expect(skeletonRows(container)).toBe(8)
      expect(screen.queryByRole('searchbox')).toBeNull()
      expect(screen.queryByText('No services connected')).toBeNull()
    })

    it('labels the columns for sighted users without cluttering the accessibility tree', () => {
      const { container } = render(<LibraryPage library={makeLibrary({}, sample)} player={makePlayer()} onOpenConnections={vi.fn()} />)

      const header = container.querySelector('.track-header')!
      expect(header.getAttribute('aria-hidden')).toBe('true')
      expect(header.textContent).toContain('Title')
      expect(header.textContent).toContain('Album')
      expect(header.textContent).toContain('Format')
    })

    it('leaves out the column headings when there is nothing to list, and explains instead', () => {
      const { container } = render(<LibraryPage library={makeLibrary()} player={makePlayer()} onOpenConnections={vi.fn()} />)

      expect(container.querySelector('.track-header')).toBeNull()
      expect(container.querySelector('.empty-state.compact')).not.toBeNull()
      expect(screen.getByText('No saved tracks found on your connected services.')).toBeTruthy()
    })

    it('marks which row is playing, so it can show it, and which is only paused', () => {
      const current = track('spotify', 1)
      const playing = render(<LibraryPage library={makeLibrary({}, sample)} player={makePlayer({ track: current, status: 'playing' })} onOpenConnections={vi.fn()} />)
      const row = (title: string): HTMLElement => rows().find((r) => r.textContent?.includes(title))!

      expect(row('Song 1').getAttribute('data-playing')).toBe('true')
      expect(row('Song 2').getAttribute('data-playing')).toBe('false')
      playing.unmount()

      render(<LibraryPage library={makeLibrary({}, sample)} player={makePlayer({ track: current, status: 'paused' })} onOpenConnections={vi.fn()} />)
      expect(row('Song 1').getAttribute('data-current')).toBe('true')
      expect(row('Song 1').getAttribute('data-playing')).toBe('false')
    })
  })
})

describe('refresh button', () => {
  const button = (name: string | RegExp = 'Refresh'): HTMLElement => screen.getByRole('button', { name })


  it('opens a menu with Refresh all and one choice per connected service', async () => {
    const library = makeLibrary({}, [track('spotify', 1)])
    render(<LibraryPage library={library} player={makePlayer()} onOpenConnections={vi.fn()} />)
    expect(screen.queryByRole('menu')).toBeNull()

    await userEvent.click(button())

    const items = within(screen.getByRole('menu', { name: 'Refresh' })).getAllByRole('menuitem')
    // SoundCloud is not connected, so it is not offered.
    expect(items.map((item) => item.textContent)).toEqual(['Refresh all', 'Refresh Spotify', 'Refresh Qobuz'])
    expect(library.refresh).not.toHaveBeenCalled()
  })

  it('refreshes every service from Refresh all', async () => {
    const library = makeLibrary({}, [track('spotify', 1)])
    render(<LibraryPage library={library} player={makePlayer()} onOpenConnections={vi.fn()} />)

    await userEvent.click(button())
    await userEvent.click(screen.getByRole('menuitem', { name: 'Refresh all' }))

    expect(library.refresh).toHaveBeenCalledExactlyOnceWith()
    expect(library.reload).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('refreshes just the chosen service', async () => {
    const library = makeLibrary({}, [track('spotify', 1)])
    render(<LibraryPage library={library} player={makePlayer()} onOpenConnections={vi.fn()} />)

    await userEvent.click(button())
    await userEvent.click(screen.getByRole('menuitem', { name: 'Refresh Qobuz' }))

    expect(library.refresh).toHaveBeenCalledExactlyOnceWith('qobuz')
  })

  it('is not offered when no service is connected', () => {
    const library = makeLibrary({ providers: [provider('spotify', 'Spotify', false)], libraries: {} })
    render(<LibraryPage library={library} player={makePlayer()} onOpenConnections={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /refresh/i })).toBeNull()
  })

  it('waits while the library is still loading, so it cannot pile up requests', () => {
    const library = makeLibrary({ loading: true }, [track('spotify', 1)])
    render(<LibraryPage library={library} player={makePlayer()} onOpenConnections={vi.fn()} />)
    expect((button() as HTMLButtonElement).disabled).toBe(true)
  })

  it('says it is refreshing, keeps the current tracks on screen and shows its progress', () => {
    const library = makeLibrary({ loading: true, refreshing: true }, [track('spotify', 1), track('spotify', 2)])
    render(<LibraryPage library={library} player={makePlayer()} onOpenConnections={vi.fn()} />)

    const busy = button('Refreshing…') as HTMLButtonElement
    expect(busy.disabled).toBe(true)
    expect(busy.getAttribute('aria-busy')).toBe('true')
    expect(busy.querySelector('svg')?.getAttribute('class')).toContain('spinning')
    expect(screen.getByRole('status').textContent).toBe('Refreshing your library…')
    expect(titles()).toEqual(['Song 2', 'Song 1'])
    // The list is real tracks, not placeholder rows.
    expect(document.querySelector('.skeleton-row')).toBeNull()
  })

  it('is idle and available once everything has loaded', () => {
    const library = makeLibrary({}, [track('spotify', 1)])
    render(<LibraryPage library={library} player={makePlayer()} onOpenConnections={vi.fn()} />)
    const idle = button() as HTMLButtonElement
    expect(idle.disabled).toBe(false)
    expect(idle.getAttribute('aria-busy')).toBe('false')
    expect(idle.querySelector('svg')?.getAttribute('class') ?? '').not.toContain('spinning')
  })
})

describe('Qobuz notice', () => {
  const NOTICE = 'This application uses the Qobuz API but is not certified by Qobuz.'

  it('is shown on the Library while Qobuz is connected, as its terms require', () => {
    const library = makeLibrary({ providers: [provider('spotify', 'Spotify', true), provider('qobuz', 'Qobuz', true)] }, [track('spotify', 1)])
    render(<LibraryPage library={library} player={makePlayer()} onOpenConnections={vi.fn()} />)
    expect(screen.getByText(NOTICE)).toBeTruthy()
  })

  it('is not shown when Qobuz is not connected', () => {
    render(<LibraryPage library={makeLibrary({}, [track('spotify', 1)])} player={makePlayer()} onOpenConnections={vi.fn()} />)
    // makeLibrary connects Spotify and Qobuz both, so take Qobuz away.
    cleanup()
    const library = makeLibrary({ providers: [provider('spotify', 'Spotify', true), provider('qobuz', 'Qobuz', false)] }, [track('spotify', 1)])
    render(<LibraryPage library={library} player={makePlayer()} onOpenConnections={vi.fn()} />)
    expect(screen.queryByText(NOTICE)).toBeNull()
  })
})
