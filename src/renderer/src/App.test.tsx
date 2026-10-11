// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TurnTableApi } from '@shared/ipc'
import type { ProviderStatus } from '@shared/types'
import { App } from './App'

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
  mediaPlay.mockReset().mockResolvedValue(undefined)
  api = {
    listProviders: vi.fn().mockResolvedValue([spotify(false)]),
    connectProvider: vi.fn().mockResolvedValue(undefined),
    disconnectProvider: vi.fn().mockResolvedValue(undefined),
    getSavedTracks: vi.fn().mockResolvedValue({
      tracks: [{ id: 't1', providerId: 'spotify', title: 'First Song', artists: ['Someone'], durationMs: 60_000 }]
    })
  }
  Object.assign(window, { turntable: api })
})
afterEach(cleanup)

const nav = (): ReturnType<typeof within> => within(screen.getByRole('navigation', { name: 'Main' }))

describe('App', () => {
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
})
