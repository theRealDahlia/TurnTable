// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderId, ProviderStatus, Track } from '@shared/types'
import type { Library } from '../library/useLibrary'
import type { Player } from '../player/usePlayer'
import type { ProviderResults, SearchState } from '../search/useSearch'
import { SearchPage } from './SearchPage'

const provider = (id: ProviderId, name: string, extra: Partial<ProviderStatus> = {}): ProviderStatus => ({
  id,
  name,
  authKind: 'oauth-pkce',
  playback: 'sdk',
  maxQuality: { codec: 'aac', lossless: false },
  connected: true,
  searchable: id === 'spotify' || id === 'youtubeMusic',
  savable: id === 'spotify' || id === 'youtubeMusic',
  ...extra
})

const SPOTIFY = provider('spotify', 'Spotify')
const YOUTUBE = provider('youtubeMusic', 'YouTube Music')
const LOCAL = provider('local', 'Local files', { authKind: 'none', playback: 'file' })
const QOBUZ = provider('qobuz', 'Qobuz', { connected: false, searchable: false, savable: false })

const track = (providerId: ProviderId, n: number, overrides: Partial<Track> = {}): Track => ({
  // Spotify ids are 22 letters and digits; anything else can't be played.
  id: providerId === 'spotify' ? `sp${n}`.padEnd(22, 'x') : `${providerId}-${n}`,
  providerId,
  title: `Everlong ${n}`,
  artists: ['Foo Fighters'],
  album: `Album ${n}`,
  durationMs: 250_000,
  saved: false,
  ...overrides
})

const ready = (tracks: Track[], extra: Partial<ProviderResults> = {}): ProviderResults => ({ status: 'ready', tracks, loadingMore: false, ...extra })

function makeLibrary(providers: ProviderStatus[] = [SPOTIFY, YOUTUBE, QOBUZ], tracks: Track[] = [], overrides: Partial<Library> = {}): Library {
  return {
    listing: false,
    providers,
    libraries: {},
    tracks,
    loading: false,
    refreshing: false,
    reload: vi.fn(),
    refresh: vi.fn(),
    refreshProvider: vi.fn(),
    retry: vi.fn(),
    ...overrides
  }
}

function makeSearch(overrides: Partial<SearchState> = {}): SearchState {
  return {
    query: '',
    results: {},
    pending: {},
    search: vi.fn(),
    loadMore: vi.fn(),
    retry: vi.fn(),
    selectTab: vi.fn(),
    toggleSave: vi.fn(),
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

afterEach(cleanup)

const show = (search: SearchState, library = makeLibrary(), player = makePlayer(), onOpenConnections = vi.fn()) => {
  render(<SearchPage library={library} player={player} search={search} onOpenConnections={onOpenConnections} />)
  return { library, player, search, onOpenConnections }
}
const tabs = (): HTMLElement[] => within(screen.getByRole('tablist', { name: 'Search results by service' })).getAllByRole('tab')
const rows = (): HTMLElement[] => within(screen.getByRole('tabpanel')).queryAllByRole('listitem')

describe('SearchPage before searching', () => {
  it('invites a search, and offers no tabs yet', () => {
    show(makeSearch())
    expect(screen.getByRole('heading', { name: 'Search' })).toBeTruthy()
    expect(screen.getByRole('search')).toBeTruthy()
    expect(screen.getByText(/Results appear under a tab for each of your services/)).toBeTruthy()
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('cannot search for nothing', async () => {
    show(makeSearch())
    const button = screen.getByRole('button', { name: 'Search' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search for songs' }), '   ')
    expect(button.disabled).toBe(true)
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search for songs' }), 'foo')
    expect(button.disabled).toBe(false)
  })

  it('searches the services that can be searched, plus local files, from one form', async () => {
    const { search } = show(makeSearch(), makeLibrary([SPOTIFY, YOUTUBE, LOCAL, QOBUZ]))
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search for songs' }), 'foo fighters{Enter}')
    expect(search.search).toHaveBeenCalledExactlyOnceWith('foo fighters', ['spotify', 'youtubeMusic'], ['spotify', 'youtubeMusic', 'local'])
  })

  it('also searches with the Search button', async () => {
    const { search } = show(makeSearch())
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search for songs' }), 'foo')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(search.search).toHaveBeenCalledExactlyOnceWith('foo', ['spotify', 'youtubeMusic'], ['spotify', 'youtubeMusic'])
  })

  it('starts with the last search typed in', () => {
    show(makeSearch({ query: 'foo fighters', tab: 'spotify', results: { spotify: ready([]) } }))
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('foo fighters')
  })

  it('points to Connections when nothing is connected', async () => {
    const { onOpenConnections } = show(makeSearch(), makeLibrary([{ ...SPOTIFY, connected: false }, QOBUZ]))
    expect(screen.getByRole('heading', { name: 'No services connected' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Search' }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Go to Connections' }))
    expect(onOpenConnections).toHaveBeenCalledOnce()
  })
})

describe('SearchPage tabs', () => {
  const searched = (overrides: Partial<SearchState> = {}, library = makeLibrary([SPOTIFY, YOUTUBE, LOCAL, QOBUZ], [track('local', 1), track('local', 2, { title: 'Other' })]) ) =>
    show(
      makeSearch({
        query: 'everlong',
        tab: 'spotify',
        results: { spotify: ready([track('spotify', 1), track('spotify', 2), track('spotify', 3)]), youtubeMusic: ready([track('youtubeMusic', 1)]) },
        ...overrides
      }),
      library
    )

  it('has one chip for each connected service, with its result count', () => {
    searched()
    expect(tabs().map((tab) => tab.textContent)).toEqual(['Spotify3', 'YouTube Music1', 'Local files1'])
    // Qobuz is not connected.
    expect(screen.queryByRole('tab', { name: /Qobuz/ })).toBeNull()
  })

  it('shows no count while a service is still searching, or if it failed', () => {
    searched({ results: { spotify: { status: 'loading', tracks: [], loadingMore: false }, youtubeMusic: { status: 'error', tracks: [], error: 'x', loadingMore: false } } })
    expect(tabs().map((tab) => tab.textContent).slice(0, 2)).toEqual(['Spotify', 'YouTube Music'])
  })

  it('marks the chosen tab, and only that one can be reached with Tab', () => {
    searched({ tab: 'youtubeMusic' })
    expect(tabs().map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false'])
    expect(tabs().map((tab) => tab.getAttribute('tabindex'))).toEqual(['-1', '0', '-1'])
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('search-tab-youtubeMusic')
  })

  it('falls back to the first tab when the chosen one is not available', () => {
    searched({ tab: 'qobuz' })
    expect(tabs()[0]?.getAttribute('aria-selected')).toBe('true')
  })

  it('switches tab when a chip is clicked', async () => {
    const { search } = searched()
    await userEvent.click(screen.getByRole('tab', { name: /YouTube Music/ }))
    expect(search.selectTab).toHaveBeenCalledExactlyOnceWith('youtubeMusic')
  })

  it('moves between tabs with the arrow keys, Home and End, wrapping around', async () => {
    const { search } = searched()
    tabs()[0]!.focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(search.selectTab).toHaveBeenLastCalledWith('youtubeMusic')
    expect(document.activeElement).toBe(tabs()[1])
    await userEvent.keyboard('{End}')
    expect(search.selectTab).toHaveBeenLastCalledWith('local')
    await userEvent.keyboard('{Home}')
    expect(search.selectTab).toHaveBeenLastCalledWith('spotify')
    await userEvent.keyboard('{ArrowLeft}')
    expect(search.selectTab).toHaveBeenLastCalledWith('local')
  })

  it('shows only the chosen tab\'s results', () => {
    searched({ tab: 'youtubeMusic' })
    expect(rows().map((row) => row.querySelector('.track-title')?.textContent)).toEqual(['Everlong 1'])
    expect(within(screen.getByRole('tabpanel')).getByRole('list', { name: 'YouTube Music results' })).toBeTruthy()
  })
})

describe('SearchPage results', () => {
  it('plays a result, with that tab\'s results as the queue', async () => {
    const results = [track('spotify', 1), track('spotify', 2)]
    const player = makePlayer()
    show(makeSearch({ query: 'e', tab: 'spotify', results: { spotify: ready(results) } }), makeLibrary(), player)

    await userEvent.click(screen.getByRole('button', { name: 'Play Everlong 2' }))

    expect(player.play).toHaveBeenCalledExactlyOnceWith(results[1], results)
  })

  it('pauses the one that is playing instead of starting it again', async () => {
    const results = [track('spotify', 1)]
    const player = makePlayer({ track: results[0], status: 'playing' })
    show(makeSearch({ query: 'e', tab: 'spotify', results: { spotify: ready(results) } }), makeLibrary(), player)

    await userEvent.click(screen.getByRole('button', { name: 'Pause Everlong 1' }))

    expect(player.toggle).toHaveBeenCalledOnce()
    expect(player.play).not.toHaveBeenCalled()
  })

  it('has a Save button on each result of a service that can save, pressed when it is saved', () => {
    show(makeSearch({ query: 'e', tab: 'spotify', results: { spotify: ready([track('spotify', 1, { saved: true }), track('spotify', 2)]) } }))
    expect(screen.getByRole('button', { name: 'Save Everlong 1', pressed: true })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save Everlong 2', pressed: false })).toBeTruthy()
  })

  it('saves or removes a result when its button is pressed', async () => {
    const first = track('spotify', 1, { saved: true })
    const { search } = show(makeSearch({ query: 'e', tab: 'spotify', results: { spotify: ready([first]) } }))
    await userEvent.click(screen.getByRole('button', { name: 'Save Everlong 1' }))
    expect(search.toggleSave).toHaveBeenCalledExactlyOnceWith(first)
  })

  it('holds a Save button while its change is being sent', () => {
    show(makeSearch({ query: 'e', tab: 'spotify', results: { spotify: ready([track('spotify', 1)]) }, pending: { [`spotify:${'sp1'.padEnd(22, 'x')}`]: true } }))
    const button = screen.getByRole('button', { name: 'Save Everlong 1' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.getAttribute('aria-busy')).toBe('true')
  })

  it('links each result back to its service', () => {
    show(makeSearch({ query: 'e', tab: 'spotify', results: { spotify: ready([track('spotify', 1, { url: 'https://open.spotify.com/track/x' })]) } }))
    expect(screen.getByRole('link', { name: 'Open Everlong 1 on Spotify' }).getAttribute('href')).toBe('https://open.spotify.com/track/x')
  })

  it('shows placeholders while a service is searching', () => {
    show(makeSearch({ query: 'e', tab: 'spotify', results: { spotify: { status: 'loading', tracks: [], loadingMore: false } } }))
    expect(document.querySelectorAll('.skeleton-row')).toHaveLength(8)
    expect(rows()).toHaveLength(0)
  })

  it('says when nothing was found', () => {
    show(makeSearch({ query: 'zzz', tab: 'spotify', results: { spotify: ready([]) } }))
    expect(screen.getByText('No Spotify results for “zzz”.')).toBeTruthy()
  })

  it("shows a failed service's error with a way to try again, without hiding the other tabs", async () => {
    const { search } = show(
      makeSearch({ query: 'e', tab: 'spotify', results: { spotify: { status: 'error', tracks: [], error: 'Spotify has temporarily limited access', loadingMore: false }, youtubeMusic: ready([track('youtubeMusic', 1)]) } })
    )
    expect(screen.getByRole('alert').textContent).toContain('Spotify: Spotify has temporarily limited access')
    expect(tabs()).toHaveLength(2)

    await userEvent.click(screen.getByRole('button', { name: 'Retry Spotify' }))
    expect(search.retry).toHaveBeenCalledExactlyOnceWith('spotify')
  })

  it('offers more results when the service has them, and waits while they load', async () => {
    const { search } = show(makeSearch({ query: 'e', tab: 'spotify', results: { spotify: ready([track('spotify', 1)], { nextCursor: '10' }) } }))
    await userEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(search.loadMore).toHaveBeenCalledExactlyOnceWith('spotify')

    cleanup()
    show(makeSearch({ query: 'e', tab: 'spotify', results: { spotify: ready([track('spotify', 1)], { nextCursor: '10', loadingMore: true }) } }))
    expect((screen.getByRole('button', { name: 'Loading…' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not offer more when there are no more', () => {
    show(makeSearch({ query: 'e', tab: 'spotify', results: { spotify: ready([track('spotify', 1)]) } }))
    expect(screen.queryByRole('button', { name: /Show more/ })).toBeNull()
  })

  it('shows a failed save under the tab it concerns only', () => {
    const search = makeSearch({
      query: 'e',
      tab: 'spotify',
      results: { spotify: ready([track('spotify', 1)]), youtubeMusic: ready([track('youtubeMusic', 1)]) },
      saveError: { providerId: 'spotify', message: 'Reconnect Spotify to allow saving songs in TurnTable.' }
    })
    show(search)
    expect(screen.getByRole('alert').textContent).toBe('Reconnect Spotify to allow saving songs in TurnTable.')

    cleanup()
    show({ ...search, tab: 'youtubeMusic' })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('suggests reconnecting a service whose sign-in cannot save yet', async () => {
    const stale = { ...SPOTIFY, needsReauthorization: true }
    const { onOpenConnections } = show(makeSearch({ query: 'e', tab: 'spotify', results: { spotify: ready([track('spotify', 1)]) } }), makeLibrary([stale, YOUTUBE]))
    expect(screen.getByRole('status').textContent).toContain('Reconnect Spotify to save songs from here.')
    await userEvent.click(screen.getByRole('button', { name: 'Connections' }))
    expect(onOpenConnections).toHaveBeenCalledOnce()
  })
})

describe('SearchPage local files', () => {
  const library = (): Library =>
    makeLibrary(
      [SPOTIFY, LOCAL],
      [track('local', 1, { title: 'Everlong (demo)', artists: ['Foo Fighters'] }), track('local', 2, { title: 'Blackbird', artists: ['The Beatles'] }), track('spotify', 9, { title: 'Everlong' })]
    )

  it('finds matches among the local files already loaded, and nothing from other services', () => {
    show(makeSearch({ query: 'everlong', tab: 'local', results: { spotify: ready([]) } }), library())
    expect(rows().map((row) => row.querySelector('.track-title')?.textContent)).toEqual(['Everlong (demo)'])
  })

  it('matches on the artist too, ignoring case and accents', () => {
    show(makeSearch({ query: 'BEATLES', tab: 'local' }), library())
    expect(rows().map((row) => row.querySelector('.track-title')?.textContent)).toEqual(['Blackbird'])
  })

  it('has no Save buttons, because those files are already yours', () => {
    show(makeSearch({ query: 'everlong', tab: 'local' }), library())
    expect(screen.queryByRole('button', { name: /^Save / })).toBeNull()
  })

  it('says when no local file matches', () => {
    show(makeSearch({ query: 'zzz', tab: 'local' }), library())
    expect(screen.getByText('No Local files results for “zzz”.')).toBeTruthy()
  })

  it('shows placeholders while the local library is still being read', () => {
    show(makeSearch({ query: 'everlong', tab: 'local' }), makeLibrary([LOCAL], [], { loading: true }))
    expect(document.querySelectorAll('.skeleton-row').length).toBeGreaterThan(0)
  })

  it('works when local files are the only thing connected', async () => {
    const { search } = show(makeSearch(), makeLibrary([{ ...SPOTIFY, connected: false }, LOCAL], [track('local', 1)]))
    await userEvent.type(screen.getByRole('searchbox'), 'everlong{Enter}')
    expect(search.search).toHaveBeenCalledExactlyOnceWith('everlong', [], ['local'])
  })
})
