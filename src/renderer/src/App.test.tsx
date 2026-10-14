// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TurnTableApi } from '@shared/ipc'
import type { SpotifyPlayerApi, SpotifyPlayerEvent } from '@shared/spotifyPlayer'
import type { ProviderStatus } from '@shared/types'
import { LEGAL_VERSION } from '@shared/legal'
import { App } from './App'
import { ACCEPTANCE_KEY } from './legal/useAcceptance'

const spotify = (connected: boolean): ProviderStatus => ({
  id: 'spotify',
  name: 'Spotify',
  authKind: 'oauth-pkce',
  playback: 'sdk',
  maxQuality: { codec: 'ogg-vorbis', lossless: false, bitrateKbps: 320 },
  connected
})

// jsdom doesn't implement media playback, so stand in for the element's methods.
const mediaPlay = vi.spyOn(HTMLMediaElement.prototype, 'play')
vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)

const localFlac = {
  id: 'a'.repeat(24),
  providerId: 'local' as const,
  title: 'Local Song',
  artists: ['Someone'],
  durationMs: 60_000,
  quality: { codec: 'flac', lossless: true, bitDepth: 16, sampleRateHz: 44100 }
}

let api: { [K in keyof TurnTableApi]: ReturnType<typeof vi.fn> }

beforeEach(() => {
  // The tests below are of the app itself, so the user has already agreed to the documents.
  window.localStorage.setItem(ACCEPTANCE_KEY, LEGAL_VERSION)
  mediaPlay.mockReset().mockResolvedValue(undefined)
  api = {
    listProviders: vi.fn().mockResolvedValue([spotify(false)]),
    connectProvider: vi.fn().mockResolvedValue(undefined),
    disconnectProvider: vi.fn().mockResolvedValue(undefined),
    getSavedTracks: vi.fn().mockResolvedValue({
      tracks: [{ id: 't1', providerId: 'spotify', title: 'First Song', artists: ['Someone'], durationMs: 60_000 }]
    }),
    searchTracks: vi.fn(),
    saveTrack: vi.fn(),
    unsaveTrack: vi.fn(),
    getArtistAlbums: vi.fn(),
    getAlbumTracks: vi.fn()
  }
  Object.assign(window, { turntable: api })
})
afterEach(cleanup)

const nav = (): ReturnType<typeof within> => within(screen.getByRole('navigation', { name: 'Main' }))

describe('App terms', () => {
  it('shows only the agreement screen, and fetches nothing, until the user agrees', async () => {
    window.localStorage.clear()
    api.listProviders.mockResolvedValue([spotify(true)])
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Before you start' })).toBeTruthy()
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    const proceed = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement
    expect(proceed.disabled).toBe(true)
    expect(api.listProviders).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('checkbox', { name: /I have read and agree/ }))
    await userEvent.click(proceed)

    expect(await screen.findByText('First Song')).toBeTruthy()
    expect(window.localStorage.getItem(ACCEPTANCE_KEY)).toBe(LEGAL_VERSION)
  })

  it('goes straight to the app once the current version has been agreed to', () => {
    render(<App />)
    expect(screen.queryByRole('heading', { name: 'Before you start' })).toBeNull()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy()
  })

  it('keeps the documents one click away from the sidebar', async () => {
    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: 'Privacy & terms' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByRole('heading', { level: 1, name: 'Muze: Privacy Policy' })).toBeTruthy()

    await userEvent.click(dialog.getByRole('button', { name: 'End-User Agreement' }))
    expect(dialog.getByRole('heading', { level: 1, name: 'Muze: End-User Agreement' })).toBeTruthy()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('App search', () => {
  const searchable = (connected: boolean): ProviderStatus => ({ ...spotify(connected), searchable: true, savable: true })
  const SONG = 'sp1'.padEnd(22, 'x')
  const found = (saved: boolean) => ({
    tracks: [{ id: SONG, providerId: 'spotify' as const, title: 'Everlong', artists: ['Foo Fighters'], durationMs: 250_000, saved }]
  })

  it('has a Search page in the sidebar, between Library and Connections', async () => {
    api.listProviders.mockResolvedValue([searchable(true)])
    render(<App />)

    expect(nav().getAllByRole('button').map((button: HTMLElement) => button.textContent)).toEqual(['Library', 'Search', 'Connections'])
    await userEvent.click(nav().getByRole('button', { name: 'Search' }))
    expect(await screen.findByRole('heading', { name: 'Search' })).toBeTruthy()
    expect(nav().getByRole('button', { name: 'Search' }).getAttribute('aria-current')).toBe('page')
  })

  it('searches, saves a result, and shows it in the Library on return without fetching the Library again', async () => {
    api.listProviders.mockResolvedValue([searchable(true)])
    api.searchTracks.mockResolvedValue(found(false))
    api.saveTrack.mockResolvedValue(undefined)
    render(<App />)
    await screen.findByText('First Song')
    expect(api.getSavedTracks).toHaveBeenCalledTimes(1)

    await userEvent.click(nav().getByRole('button', { name: 'Search' }))
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Search for songs' }), 'foo fighters{Enter}')
    expect(await screen.findByText('Everlong')).toBeTruthy()
    expect(api.searchTracks).toHaveBeenCalledWith('spotify', 'foo fighters')

    await userEvent.click(screen.getByRole('button', { name: 'Save Everlong', pressed: false }))
    expect(await screen.findByRole('button', { name: 'Save Everlong', pressed: true })).toBeTruthy()
    expect(api.saveTrack).toHaveBeenCalledExactlyOnceWith('spotify', SONG)
    // Nothing is fetched while still on the Search page.
    expect(api.getSavedTracks).toHaveBeenCalledTimes(1)

    await userEvent.click(nav().getByRole('button', { name: 'Library' }))
    expect(await screen.findByText('Everlong')).toBeTruthy()
    expect(screen.getByText('First Song')).toBeTruthy()
    // The saved song was added to the list already loaded; nothing was fetched.
    expect(api.getSavedTracks).toHaveBeenCalledTimes(1)
  })

  it('takes a song out of the Library when it is removed from Search', async () => {
    api.listProviders.mockResolvedValue([searchable(true)])
    api.getSavedTracks.mockResolvedValue({ tracks: [{ id: SONG, providerId: 'spotify', title: 'Everlong', artists: ['Foo Fighters'], durationMs: 250_000 }, { id: 't1', providerId: 'spotify', title: 'First Song', artists: ['Someone'], durationMs: 60_000 }] })
    api.searchTracks.mockResolvedValue(found(true))
    api.unsaveTrack.mockResolvedValue(undefined)
    render(<App />)
    await screen.findByText('Everlong')

    await userEvent.click(nav().getByRole('button', { name: 'Search' }))
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Search for songs' }), 'foo{Enter}')
    await userEvent.click(await screen.findByRole('button', { name: 'Save Everlong', pressed: true }))
    await waitFor(() => expect(api.unsaveTrack).toHaveBeenCalledExactlyOnceWith('spotify', SONG))
    await userEvent.click(nav().getByRole('button', { name: 'Library' }))

    expect(await screen.findByText('First Song')).toBeTruthy()
    expect(within(screen.getByRole('list', { name: 'Saved tracks' })).queryByText('Everlong')).toBeNull()
    expect(api.getSavedTracks).toHaveBeenCalledTimes(1)
  })

  it('does not re-read the library when nothing was saved', async () => {
    api.listProviders.mockResolvedValue([searchable(true)])
    render(<App />)
    await screen.findByText('First Song')

    await userEvent.click(nav().getByRole('button', { name: 'Search' }))
    await userEvent.click(nav().getByRole('button', { name: 'Library' }))
    await screen.findByText('First Song')

    expect(api.getSavedTracks).toHaveBeenCalledTimes(1)
  })

  it('keeps the results when switching pages and coming back', async () => {
    api.listProviders.mockResolvedValue([searchable(true)])
    api.searchTracks.mockResolvedValue(found(false))
    render(<App />)
    await screen.findByText('First Song')

    await userEvent.click(nav().getByRole('button', { name: 'Search' }))
    await userEvent.type(await screen.findByRole('searchbox'), 'foo{Enter}')
    await screen.findByText('Everlong')
    await userEvent.click(nav().getByRole('button', { name: 'Connections' }))
    await userEvent.click(nav().getByRole('button', { name: 'Search' }))

    expect(await screen.findByText('Everlong')).toBeTruthy()
    expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('foo')
    expect(api.searchTracks).toHaveBeenCalledTimes(1)
  })
})

describe('App', () => {
  it("opens an artist's page from a song, and Back returns to the Library as it was", async () => {
    api.listProviders.mockResolvedValue([spotify(true)])
    api.getSavedTracks.mockResolvedValue({
      tracks: [
        { id: 't1', providerId: 'spotify', title: 'First Song', artists: ['Someone'], durationMs: 60_000 },
        { id: 't2', providerId: 'spotify', title: 'Second Song', artists: ['Someone Else'], durationMs: 60_000 }
      ]
    })
    render(<App />)
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Search your library' }), 'first')
    const row = (await screen.findByText('First Song')).closest('li') as HTMLElement

    await userEvent.click(within(row).getByRole('button', { name: 'Someone' }))

    expect(screen.getByRole('heading', { level: 1, name: 'Someone' })).toBeTruthy()
    expect(within(screen.getByRole('list', { name: 'Someone in your library' })).getByText('First Song')).toBeTruthy()
    expect(screen.queryByText('Second Song')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Back to Library' }))

    expect(screen.getByRole('heading', { level: 1, name: 'Library' })).toBeTruthy()
    // The page underneath kept what had been typed into it.
    expect((screen.getByRole('searchbox', { name: 'Search your library' }) as HTMLInputElement).value).toBe('first')
    expect(api.getSavedTracks).toHaveBeenCalledOnce()
  })

  it("opens an album from an artist's page, plays it, and goes back to the artist", async () => {
    api.listProviders.mockResolvedValue([{ ...spotify(true), albums: true }])
    api.getSavedTracks.mockResolvedValue({ tracks: [{ id: 't1', providerId: 'spotify', title: 'First Song', artists: ['Someone'], artistIds: ['ar1'], durationMs: 60_000 }] })
    api.getArtistAlbums.mockResolvedValue({ albums: [{ id: 'al1', providerId: 'spotify', title: 'Debut', artists: ['Someone'], kind: 'album' }] })
    api.getAlbumTracks.mockResolvedValue({ tracks: [{ id: 'x1', providerId: 'spotify', title: 'Opener', artists: ['Someone'], durationMs: 60_000 }] })
    render(<App />)
    const row = (await screen.findByText('First Song')).closest('li') as HTMLElement
    await userEvent.click(within(row).getByRole('button', { name: 'Someone' }))

    await userEvent.click(await screen.findByRole('button', { name: /Debut/ }))

    expect(screen.getByRole('heading', { level: 1, name: 'Debut' })).toBeTruthy()
    expect(api.getArtistAlbums).toHaveBeenCalledWith('spotify', 'ar1')
    expect(await screen.findByText('Opener')).toBeTruthy()
    expect(api.getAlbumTracks).toHaveBeenCalledWith('spotify', 'al1', undefined)

    await userEvent.click(screen.getByRole('button', { name: 'Back to Someone' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Someone' })).toBeTruthy()
    // The artist's page was kept as it was, so going back fetched nothing again.
    expect(api.getArtistAlbums).toHaveBeenCalledOnce()
  })

  it("goes back to an artist already open, rather than opening them twice, when they are clicked on their album", async () => {
    api.listProviders.mockResolvedValue([{ ...spotify(true), albums: true }])
    api.getSavedTracks.mockResolvedValue({ tracks: [{ id: 't1', providerId: 'spotify', title: 'First Song', artists: ['Someone'], artistIds: ['ar1'], durationMs: 60_000 }] })
    api.getArtistAlbums.mockResolvedValue({ albums: [{ id: 'al1', providerId: 'spotify', title: 'Debut', artists: ['Someone'], artistIds: ['ar1'] }] })
    api.getAlbumTracks.mockResolvedValue({ tracks: [] })
    render(<App />)
    const row = (await screen.findByText('First Song')).closest('li') as HTMLElement
    await userEvent.click(within(row).getByRole('button', { name: 'Someone' }))
    await userEvent.click(await screen.findByRole('button', { name: /Debut/ }))

    await userEvent.click(within(document.querySelector('.album-byline') as HTMLElement).getByRole('button', { name: 'Someone' }))

    expect(screen.getByRole('heading', { level: 1, name: 'Someone' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back to Library' })).toBeTruthy()
    expect(api.getArtistAlbums).toHaveBeenCalledOnce()
  })

  it('walks back through artists opened one from another, and the sidebar leaves them all', async () => {
    api.listProviders.mockResolvedValue([spotify(true)])
    api.getSavedTracks.mockResolvedValue({ tracks: [{ id: 't1', providerId: 'spotify', title: 'Duet', artists: ['Ana', 'Ben'], durationMs: 60_000 }] })
    render(<App />)
    const row = (await screen.findByText('Duet')).closest('li') as HTMLElement
    await userEvent.click(within(row).getByRole('button', { name: 'Ana' }))
    const onAna = within(screen.getByRole('list', { name: 'Ana in your library' }))
    await userEvent.click(onAna.getByRole('button', { name: 'Ben' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Ben' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Back to Ana' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Ana' })).toBeTruthy()

    await userEvent.click(nav().getByRole('button', { name: 'Search' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Search' })).toBeTruthy()
    expect(screen.queryByRole('heading', { level: 1, name: 'Ana' })).toBeNull()
  })

  it('opens on the Library and marks it as the current page', async () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Library' })).toBeTruthy()
    expect(nav().getByRole('button', { name: 'Library' }).getAttribute('aria-current')).toBe('page')
    expect(nav().getByRole('button', { name: 'Connections' }).getAttribute('aria-current')).toBeNull()
    expect(await screen.findByText('No services connected')).toBeTruthy()
  })

  it('switches between pages from the sidebar', async () => {
    render(<App />)

    await userEvent.click(nav().getByRole('button', { name: 'Connections' }))
    expect(await screen.findByRole('heading', { name: 'Connections' })).toBeTruthy()
    expect(nav().getByRole('button', { name: 'Connections' }).getAttribute('aria-current')).toBe('page')

    await userEvent.click(nav().getByRole('button', { name: 'Library' }))
    expect(screen.getByRole('heading', { name: 'Library' })).toBeTruthy()
  })

  it('takes the user from the empty Library to Connections', async () => {
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: 'Go to Connections' }))
    expect(await screen.findByRole('heading', { name: 'Connections' })).toBeTruthy()
  })

  it('loads the library after a service is connected', async () => {
    render(<App />)
    await screen.findByText('No services connected')
    expect(api.getSavedTracks).not.toHaveBeenCalled()

    // The service only becomes connected once the user has gone through sign-in.
    api.connectProvider.mockImplementation(async () => {
      api.listProviders.mockResolvedValue([spotify(true)])
    })
    await userEvent.click(nav().getByRole('button', { name: 'Connections' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Spotify' }))
    await waitFor(() => expect(api.connectProvider).toHaveBeenCalledWith('spotify'))

    await userEvent.click(nav().getByRole('button', { name: 'Library' }))
    expect(await screen.findByText('First Song')).toBeTruthy()
    expect(api.getSavedTracks).toHaveBeenCalledWith('spotify', undefined)
  })

  it('keeps the library when switching pages without re-fetching it', async () => {
    api.listProviders.mockResolvedValue([spotify(true)])
    render(<App />)
    await screen.findByText('First Song')

    await userEvent.click(nav().getByRole('button', { name: 'Connections' }))
    await screen.findByRole('heading', { name: 'Connections' })
    await userEvent.click(nav().getByRole('button', { name: 'Library' }))

    expect(screen.getByText('First Song')).toBeTruthy()
    expect(api.getSavedTracks).toHaveBeenCalledTimes(1)
  })

  describe('playback', () => {
    const localProvider = (): ProviderStatus => ({
      id: 'local',
      name: 'Local files',
      authKind: 'none',
      playback: 'file',
      maxQuality: { codec: 'flac', lossless: true },
      connected: true
    })
    const openLibraryWithLocalTrack = async (): Promise<void> => {
      api.listProviders.mockResolvedValue([localProvider()])
      api.getSavedTracks.mockResolvedValue({ tracks: [localFlac] })
      render(<App />)
      await screen.findByText('Local Song')
    }

    it('has no player bar until something is played', async () => {
      await openLibraryWithLocalTrack()
      expect(screen.queryByRole('contentinfo', { name: 'Player' })).toBeNull()
    })

    it('plays a track and shows the player bar with its format', async () => {
      await openLibraryWithLocalTrack()

      await userEvent.click(screen.getByRole('button', { name: 'Play Local Song' }))

      const bar = within(await screen.findByRole('contentinfo', { name: 'Player' }))
      expect(bar.getByText('Local Song')).toBeTruthy()
      expect(bar.getByText('FLAC · 16-bit / 44.1 kHz')).toBeTruthy()
      expect(mediaPlay).toHaveBeenCalledOnce()
    })

    it('keeps playing when the user switches to Connections and back', async () => {
      await openLibraryWithLocalTrack()
      await userEvent.click(screen.getByRole('button', { name: 'Play Local Song' }))
      await screen.findByRole('contentinfo', { name: 'Player' })

      await userEvent.click(nav().getByRole('button', { name: 'Connections' }))
      expect(await screen.findByRole('heading', { name: 'Connections' })).toBeTruthy()
      expect(screen.getByRole('contentinfo', { name: 'Player' })).toBeTruthy()
    })

    it('toggles playback with Space, but not while typing in the search box', async () => {
      await openLibraryWithLocalTrack()
      await userEvent.click(screen.getByRole('button', { name: 'Play Local Song' }))
      await screen.findByRole('contentinfo', { name: 'Player' })
      mediaPlay.mockClear()

      // The element is "paused" in jsdom, so a toggle resumes it.
      await userEvent.click(document.body)
      await userEvent.keyboard(' ')
      expect(mediaPlay).toHaveBeenCalledOnce()

      mediaPlay.mockClear()
      await userEvent.click(screen.getByRole('searchbox'))
      await userEvent.keyboard('a b')
      expect(mediaPlay).not.toHaveBeenCalled()
      expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('a b')
    })
  })

  describe('Spotify playback', () => {
    const FIRST = '4iV5W9uYEdYUVa79Axb7Rh'
    const SECOND = '1301WleyT98MSxVHPZCA6M'
    const spotifyTrack = (id: string, title: string, savedAt: string) => ({
      id,
      providerId: 'spotify' as const,
      title,
      artists: ['Artist'],
      durationMs: 200_000,
      savedAt
    })
    // Newest first: Spotify One, Spotify Two, then the local file.
    const library = {
      spotify: [spotifyTrack(FIRST, 'Spotify One', '2026-03-01T00:00:00Z'), spotifyTrack(SECOND, 'Spotify Two', '2026-02-01T00:00:00Z')],
      local: [{ ...localFlac, savedAt: '2026-01-01T00:00:00Z' }]
    }
    // The player and the media-key handling both listen, as they do for real.
    const listeners = new Set<(event: SpotifyPlayerEvent) => void>()
    let spotifyApi: { [K in keyof SpotifyPlayerApi]: ReturnType<typeof vi.fn> }

    const emit = (event: SpotifyPlayerEvent): void => act(() => [...listeners].forEach((listener) => listener(event)))
    const playingState = (trackId: string, overrides: Partial<Extract<SpotifyPlayerEvent, { type: 'state' }>> = {}): SpotifyPlayerEvent => ({
      type: 'state',
      trackId,
      linkedFromId: null,
      paused: false,
      positionMs: 1000,
      durationMs: 200_000,
      ended: false,
      ...overrides
    })

    beforeEach(() => {
      listeners.clear()
      spotifyApi = {
        play: vi.fn().mockResolvedValue(undefined),
        pause: vi.fn().mockResolvedValue(undefined),
        resume: vi.fn().mockResolvedValue(undefined),
        seek: vi.fn().mockResolvedValue(undefined),
        setVolume: vi.fn().mockResolvedValue(undefined),
        onEvent: vi.fn((cb: (event: SpotifyPlayerEvent) => void) => {
          listeners.add(cb)
          return () => void listeners.delete(cb)
        })
      }
      Object.assign(window, { turntableSpotify: spotifyApi })
      api.listProviders.mockResolvedValue([{ ...spotify(true) }, { id: 'local', name: 'Local files', authKind: 'none', playback: 'file', maxQuality: { codec: 'flac', lossless: true }, connected: true }])
      api.getSavedTracks.mockImplementation(async (id: 'spotify' | 'local') => ({ tracks: library[id] }))
    })

    const openLibrary = async (): Promise<void> => {
      render(<App />)
      await screen.findByText('Spotify One')
    }

    it('plays a Spotify track from the library through the Spotify player', async () => {
      await openLibrary()

      await userEvent.click(screen.getByRole('button', { name: 'Play Spotify One' }))

      expect(spotifyApi.play).toHaveBeenCalledExactlyOnceWith(FIRST)
      const bar = within(await screen.findByRole('contentinfo', { name: 'Player' }))
      expect(bar.getByText('Spotify One')).toBeTruthy()
      expect(bar.getByRole('button', { name: 'Pause' })).toBeTruthy() // loading counts as about to play
      expect(mediaPlay).not.toHaveBeenCalled() // the local audio element stays silent

      emit(playingState(FIRST, { positionMs: 65_000 }))
      expect(bar.getByText('1:05')).toBeTruthy()
      expect(bar.getByText('3:20')).toBeTruthy()
    })

    it("lets go of the Spotify track playing when Spotify is disconnected, so none of its content stays on screen", async () => {
      await openLibrary()
      await userEvent.click(screen.getByRole('button', { name: 'Play Spotify One' }))
      emit(playingState(FIRST))
      await screen.findByRole('contentinfo', { name: 'Player' })

      api.disconnectProvider.mockImplementation(async () => {
        api.listProviders.mockResolvedValue([{ ...spotify(false) }, { id: 'local', name: 'Local files', authKind: 'none', playback: 'file', maxQuality: { codec: 'flac', lossless: true }, connected: true }])
      })
      await userEvent.click(nav().getByRole('button', { name: 'Connections' }))
      await userEvent.click(await screen.findByRole('button', { name: 'Disconnect Spotify' }))
      await waitFor(() => expect(api.disconnectProvider).toHaveBeenCalledWith('spotify'))

      await waitFor(() => expect(screen.queryByRole('contentinfo', { name: 'Player' })).toBeNull())
    })

    it('pauses and resumes Spotify with Space', async () => {
      await openLibrary()
      await userEvent.click(screen.getByRole('button', { name: 'Play Spotify One' }))
      await screen.findByRole('contentinfo', { name: 'Player' })
      emit(playingState(FIRST))

      await userEvent.click(document.body)
      await userEvent.keyboard(' ')
      expect(spotifyApi.pause).toHaveBeenCalledOnce()
      expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy()

      await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 750))))
      await userEvent.keyboard(' ')
      expect(spotifyApi.resume).toHaveBeenCalledOnce()
    })

    it('moves on to the next Spotify track when one ends, and stops after the last rather than moving to another service', async () => {
      await openLibrary()
      await userEvent.click(screen.getByRole('button', { name: 'Play Spotify One' }))
      emit(playingState(FIRST))

      emit(playingState(FIRST, { paused: true, positionMs: 0, ended: true }))
      await vi.waitFor(() => expect(spotifyApi.play).toHaveBeenLastCalledWith(SECOND))
      expect(within(screen.getByRole('contentinfo', { name: 'Player' })).getByText('Spotify Two')).toBeTruthy()

      emit(playingState(SECOND))
      emit(playingState(SECOND, { paused: true, positionMs: 0, ended: true }))
      // The local file is another service's, so the queue ends here.
      expect(mediaPlay).not.toHaveBeenCalled()
      expect(spotifyApi.play).toHaveBeenCalledTimes(2)
      expect(within(screen.getByRole('contentinfo', { name: 'Player' })).queryByText('Local Song')).toBeNull()
    })

    it('stops Spotify when the user picks a local file mid-song', async () => {
      await openLibrary()
      await userEvent.click(screen.getByRole('button', { name: 'Play Spotify One' }))
      emit(playingState(FIRST))

      await userEvent.click(screen.getByRole('button', { name: /^Local files/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Play Local Song' }))

      expect(spotifyApi.pause).toHaveBeenCalled()
      expect(mediaPlay).toHaveBeenCalledOnce()
      expect(within(screen.getByRole('contentinfo', { name: 'Player' })).getByText('Local Song')).toBeTruthy()
    })

    it('ignores Spotify events while a local file is playing', async () => {
      await openLibrary()
      await userEvent.click(screen.getByRole('button', { name: /^Local files/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Play Local Song' }))
      await screen.findByRole('contentinfo', { name: 'Player' })

      emit({ type: 'error', kind: 'account', message: 'Spotify Premium is required to play music in Muze.' })
      emit(playingState(FIRST, { positionMs: 99_000 }))

      expect(screen.queryByRole('alert')).toBeNull()
    })

    it.each([
      ['a free account', 'Spotify Premium is required to play music in Muze.'],
      ['a sign-in that predates playback', 'Reconnect Spotify to allow playback in Muze.']
    ])('tells the user why when Spotify refuses to play (%s)', async (_label, message) => {
      spotifyApi.play.mockRejectedValue(new Error(`Error invoking remote method 'spotify:play': Error: ${message}`))
      await openLibrary()

      await userEvent.click(screen.getByRole('button', { name: 'Play Spotify One' }))

      expect((await screen.findByRole('alert')).textContent).toBe(message)
      expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy()
    })

    it('shows an error Spotify reports while a track is playing', async () => {
      await openLibrary()
      await userEvent.click(screen.getByRole('button', { name: 'Play Spotify One' }))
      emit(playingState(FIRST))

      emit({ type: 'error', kind: 'playback', message: 'Spotify could not play this track: Cannot load track' })

      expect((await screen.findByRole('alert')).textContent).toBe('Spotify could not play this track: Cannot load track')
    })
  })

  describe('changing one service', () => {
    const localStatus = (connected: boolean): ProviderStatus => ({
      id: 'local',
      name: 'Local files',
      authKind: 'none',
      playback: 'file',
      maxQuality: { codec: 'flac', lossless: true },
      connected
    })
    const requested = (id: string): number => api.getSavedTracks.mock.calls.filter((call) => call[0] === id).length

    beforeEach(() => {
      api.getSavedTracks.mockImplementation(async (id: 'spotify' | 'local') => ({
        tracks: id === 'spotify' ? [{ ...localFlac, id: 'S'.repeat(22), providerId: 'spotify' as const, title: 'Spotify Song' }] : [localFlac]
      }))
    })

    it('choosing local folders does not fetch the Spotify library again', async () => {
      api.listProviders.mockResolvedValue([spotify(true), localStatus(false)])
      render(<App />)
      await screen.findByText('Spotify Song')
      expect(requested('spotify')).toBe(1)

      // Picking folders connects Local files, which is then reported as connected.
      api.connectProvider.mockImplementation(async () => {
        api.listProviders.mockResolvedValue([spotify(true), localStatus(true)])
      })
      await userEvent.click(nav().getByRole('button', { name: 'Connections' }))
      await userEvent.click(await screen.findByRole('button', { name: 'Choose folders Local files' }))
      await waitFor(() => expect(api.connectProvider).toHaveBeenCalledWith('local'))

      await userEvent.click(nav().getByRole('button', { name: 'Library' }))
      // Each service has its own list, so Local files is chosen to see its tracks.
      expect(await screen.findByText('Spotify Song')).toBeTruthy()
      await userEvent.click(screen.getByRole('button', { name: /^Local files/ }))
      expect(await screen.findByText('Local Song')).toBeTruthy()
      expect(requested('local')).toBe(1)
      expect(requested('spotify')).toBe(1)
    })

    it('disconnecting one service drops its tracks without fetching anything', async () => {
      api.listProviders.mockResolvedValue([spotify(true), localStatus(true)])
      render(<App />)
      await screen.findByText('Spotify Song')
      await userEvent.click(screen.getByRole('button', { name: /^Local files/ }))
      await screen.findByText('Local Song')
      api.getSavedTracks.mockClear()

      api.disconnectProvider.mockImplementation(async () => {
        api.listProviders.mockResolvedValue([spotify(true), localStatus(false)])
      })
      await userEvent.click(nav().getByRole('button', { name: 'Connections' }))
      await userEvent.click(await screen.findByRole('button', { name: 'Remove folders Local files' }))
      await waitFor(() => expect(api.disconnectProvider).toHaveBeenCalledWith('local'))
      await userEvent.click(nav().getByRole('button', { name: 'Library' }))

      await waitFor(() => expect(screen.queryByText('Local Song')).toBeNull())
      expect(screen.getByText('Spotify Song')).toBeTruthy()
      expect(api.getSavedTracks).not.toHaveBeenCalled()
    })
  })
})
