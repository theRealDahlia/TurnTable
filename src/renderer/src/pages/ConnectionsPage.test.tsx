// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TurnTableApi } from '@shared/ipc'
import type { ProviderStatus } from '@shared/types'
import { ConnectionsPage } from './ConnectionsPage'

const lossy = { codec: 'ogg-vorbis', lossless: false, bitrateKbps: 320 }
const lossless = { codec: 'flac', lossless: true, sampleRateHz: 192000, bitDepth: 24 }

const provider = (overrides: Partial<ProviderStatus>): ProviderStatus => ({
  id: 'spotify',
  name: 'Spotify',
  authKind: 'oauth-pkce',
  playback: 'sdk',
  maxQuality: lossy,
  connected: false,
  ...overrides
})

const ALL: ProviderStatus[] = [
  provider({ id: 'spotify', name: 'Spotify' }),
  provider({ id: 'youtubeMusic', name: 'YouTube' }),
  provider({ id: 'tidal', name: 'TIDAL', maxQuality: lossless }),
  provider({ id: 'local', name: 'Local files', authKind: 'none', maxQuality: lossless })
]

let api: { [K in keyof TurnTableApi]: ReturnType<typeof vi.fn> }

beforeEach(() => {
  api = {
    listProviders: vi.fn().mockResolvedValue(ALL),
    connectProvider: vi.fn().mockResolvedValue(undefined),
    disconnectProvider: vi.fn().mockResolvedValue(undefined),
    getSavedTracks: vi.fn(),
    searchTracks: vi.fn(),
    saveTrack: vi.fn(),
    unsaveTrack: vi.fn(),
    getArtistAlbums: vi.fn(),
    getAlbumTracks: vi.fn()
  }
  Object.assign(window, { turntable: api })
})

afterEach(cleanup)

describe('ConnectionsPage', () => {
  it('shows a chip with a logo for every service', async () => {
    render(<ConnectionsPage />)

    const chips = await screen.findAllByRole('listitem')
    expect(chips).toHaveLength(4)
    for (const { name } of ALL) {
      expect(screen.getByRole('img', { name: `${name} logo` })).toBeTruthy()
    }
  })

  it('renders brand marks as colored icons or image files, with a generic glyph only for local files', async () => {
    render(<ConnectionsPage />)
    await screen.findAllByRole('listitem')

    expect(screen.getByRole('img', { name: 'YouTube logo' }).getAttribute('fill')).toMatch(/^#[0-9A-F]{6}$/i)

    // Spotify's own icon files, in the monochrome versions (white for dark, black for light), never its green.
    const spotify = screen.getByRole('img', { name: 'Spotify logo' })
    expect(spotify.tagName).toBe('IMG')
    expect(spotify.closest('li')?.querySelectorAll('img.spotify-icon-on-dark, img.spotify-icon-on-light')).toHaveLength(2)
    expect(spotify.closest('li')?.querySelector('svg[fill="#1ED760"]')).toBeNull()

    expect(screen.getByRole('img', { name: 'TIDAL logo' }).tagName.toLowerCase()).toBe('svg')

    expect(screen.getByRole('img', { name: 'Local files logo' }).getAttribute('fill')).toBe('none')
  })

  it('describes each service by status and best quality', async () => {
    render(<ConnectionsPage />)
    const tidal = (await screen.findByRole('img', { name: 'TIDAL logo' })).closest('li')!

    expect(within(tidal).getByText(/Not connected/)).toBeTruthy()
    expect(within(tidal).getByText(/FLAC up to 24-bit \/ 192 kHz/)).toBeTruthy()
    const spotify = screen.getByRole('img', { name: 'Spotify logo' }).closest('li')!
    expect(within(spotify).getByText(/Ogg Vorbis up to 320 kbps/)).toBeTruthy()
    expect(screen.getByText('0 of 4 connected')).toBeTruthy()
  })

  it('connects a service and refreshes the list', async () => {
    api.listProviders
      .mockResolvedValueOnce(ALL)
      .mockResolvedValue(ALL.map((p) => (p.id === 'spotify' ? { ...p, connected: true } : p)))
    render(<ConnectionsPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Connect Spotify' }))

    expect(api.connectProvider).toHaveBeenCalledWith('spotify')
    expect(await screen.findByRole('button', { name: 'Disconnect Spotify' })).toBeTruthy()
    expect(screen.getByText('1 of 4 connected')).toBeTruthy()
  })

  it('disconnects a connected service', async () => {
    api.listProviders.mockResolvedValue(ALL.map((p) => (p.id === 'tidal' ? { ...p, connected: true } : p)))
    render(<ConnectionsPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect TIDAL' }))

    expect(api.disconnectProvider).toHaveBeenCalledWith('tidal')
  })

  it('shows a readable, dismissible error when connecting fails', async () => {
    api.connectProvider.mockRejectedValue(
      new Error("Error invoking remote method 'providers:connect': NotImplementedError: Spotify sign-in is not implemented yet")
    )
    render(<ConnectionsPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Connect Spotify' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Spotify sign-in is not implemented yet')
    expect(alert.textContent).not.toContain('Error invoking')
    // The button must be usable again after a failure.
    expect((screen.getByRole('button', { name: 'Connect Spotify' }) as HTMLButtonElement).disabled).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss error' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('disables only the chip that is busy while a request is in flight', async () => {
    let finish!: () => void
    api.connectProvider.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
    render(<ConnectionsPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Connect Spotify' }))

    expect((screen.getByRole('button', { name: 'Connect Spotify' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Connect TIDAL' }) as HTMLButtonElement).disabled).toBe(false)

    finish()
    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Connect Spotify' }) as HTMLButtonElement).disabled).toBe(false)
    )
  })

  it('reports a failure to load services', async () => {
    api.listProviders.mockRejectedValue(new Error('boom'))
    render(<ConnectionsPage />)

    expect((await screen.findByRole('alert')).textContent).toContain('boom')
    expect(screen.queryByText('Loading services…')).toBeNull()
  })

  describe('Local files', () => {
    const local = (connected: boolean): ProviderStatus =>
      provider({ id: 'local', name: 'Local files', authKind: 'none', playback: 'file', maxQuality: lossless, connected })

    it('asks the user to choose folders, since there is no account to connect', async () => {
      api.listProviders.mockResolvedValue([local(false)])
      render(<ConnectionsPage />)

      await userEvent.click(await screen.findByRole('button', { name: 'Choose folders Local files' }))

      expect(api.connectProvider).toHaveBeenCalledWith('local')
      expect(screen.queryByRole('button', { name: /Add folders/ })).toBeNull()
    })

    it('lets the user add more folders, or remove them all, once connected', async () => {
      api.listProviders.mockResolvedValue([local(true)])
      render(<ConnectionsPage />)

      await userEvent.click(await screen.findByRole('button', { name: 'Add folders to Local files' }))
      expect(api.connectProvider).toHaveBeenCalledWith('local')
      expect(api.disconnectProvider).not.toHaveBeenCalled()

      await userEvent.click(await screen.findByRole('button', { name: 'Remove folders Local files' }))
      expect(api.disconnectProvider).toHaveBeenCalledWith('local')
    })

    it('does not offer folder choices on streaming services', async () => {
      render(<ConnectionsPage />)
      for (const name of ['Spotify', 'TIDAL']) {
        const chip = (await screen.findByRole('img', { name: `${name} logo` })).closest('li')!
        expect(within(chip).queryByRole('button', { name: /folders/i })).toBeNull()
      }
    })
  })

  describe('reconnecting for new permissions', () => {
    const stale = (): ProviderStatus => provider({ connected: true, needsReauthorization: true })

    it('offers Reconnect instead of Disconnect, and explains why', async () => {
      api.listProviders.mockResolvedValue([stale()])
      render(<ConnectionsPage />)

      expect(await screen.findByText(/Reconnect to enable playback/)).toBeTruthy()
      expect(screen.queryByRole('button', { name: 'Disconnect Spotify' })).toBeNull()

      await userEvent.click(screen.getByRole('button', { name: 'Reconnect Spotify' }))
      expect(api.connectProvider).toHaveBeenCalledWith('spotify')
      expect(api.disconnectProvider).not.toHaveBeenCalled()
    })

    it('shows a normal connected chip once permissions are up to date', async () => {
      api.listProviders.mockResolvedValue([provider({ connected: true, needsReauthorization: false })])
      render(<ConnectionsPage />)
      expect(await screen.findByRole('button', { name: 'Disconnect Spotify' })).toBeTruthy()
    })
  })

  describe('telling the app what changed', () => {
    const connectedOnly = (...ids: ProviderStatus['id'][]): ProviderStatus[] =>
      ALL.map((p) => ({ ...p, connected: ids.includes(p.id) }))

    it('reports the service that was connected', async () => {
      const onChanged = vi.fn()
      render(<ConnectionsPage onChanged={onChanged} />)

      await userEvent.click(await screen.findByRole('button', { name: 'Connect Spotify' }))

      await waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
      expect(onChanged).toHaveBeenCalledWith('spotify')
    })

    it('reports the service that was disconnected', async () => {
      api.listProviders.mockResolvedValue(connectedOnly('tidal'))
      const onChanged = vi.fn()
      render(<ConnectionsPage onChanged={onChanged} />)

      await userEvent.click(await screen.findByRole('button', { name: 'Disconnect TIDAL' }))

      await waitFor(() => expect(onChanged).toHaveBeenCalledExactlyOnceWith('tidal'))
    })

    it('reports a service that was reconnected for new permissions', async () => {
      api.listProviders.mockResolvedValue(ALL.map((p) => (p.id === 'spotify' ? { ...p, connected: true, needsReauthorization: true } : p)))
      const onChanged = vi.fn()
      render(<ConnectionsPage onChanged={onChanged} />)

      await userEvent.click(await screen.findByRole('button', { name: 'Reconnect Spotify' }))

      await waitFor(() => expect(onChanged).toHaveBeenCalledExactlyOnceWith('spotify'))
    })

    it('reports Local files when more folders are added', async () => {
      api.listProviders.mockResolvedValue(connectedOnly('local'))
      const onChanged = vi.fn()
      render(<ConnectionsPage onChanged={onChanged} />)

      await userEvent.click(await screen.findByRole('button', { name: 'Add folders to Local files' }))

      await waitFor(() => expect(onChanged).toHaveBeenCalledExactlyOnceWith('local'))
    })

    it('says nothing when the change did not happen', async () => {
      api.connectProvider.mockRejectedValue(new Error('Spotify sign-in was cancelled'))
      const onChanged = vi.fn()
      render(<ConnectionsPage onChanged={onChanged} />)

      await userEvent.click(await screen.findByRole('button', { name: 'Connect Spotify' }))

      await screen.findByRole('alert')
      expect(onChanged).not.toHaveBeenCalled()
    })

    it('works without anyone listening', async () => {
      render(<ConnectionsPage />)
      await userEvent.click(await screen.findByRole('button', { name: 'Connect Spotify' }))
      await waitFor(() => expect(api.connectProvider).toHaveBeenCalledWith('spotify'))
    })
  })
})
