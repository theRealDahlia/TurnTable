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
  provider({ id: 'youtubeMusic', name: 'YouTube Music' }),
  provider({ id: 'soundcloud', name: 'SoundCloud' }),
  provider({ id: 'qobuz', name: 'Qobuz', maxQuality: lossless }),
  provider({ id: 'local', name: 'Local files', authKind: 'none', maxQuality: lossless })
]

let api: { [K in keyof TurnTableApi]: ReturnType<typeof vi.fn> }

beforeEach(() => {
  api = {
    listProviders: vi.fn().mockResolvedValue(ALL),
    connectProvider: vi.fn().mockResolvedValue(undefined),
    disconnectProvider: vi.fn().mockResolvedValue(undefined),
    getSavedTracks: vi.fn()
  }
  Object.assign(window, { turntable: api })
})

afterEach(cleanup)

describe('ConnectionsPage', () => {
  it('shows a chip with a logo for every service', async () => {
    render(<ConnectionsPage />)

    const chips = await screen.findAllByRole('listitem')
    expect(chips).toHaveLength(5)
    for (const { name } of ALL) {
      expect(screen.getByRole('img', { name: `${name} logo` })).toBeTruthy()
    }
  })

  it('renders brand-colored marks and falls back to a generic glyph without one', async () => {
    render(<ConnectionsPage />)
    await screen.findAllByRole('listitem')

    expect(screen.getByRole('img', { name: 'Spotify logo' }).getAttribute('fill')).toMatch(/^#[0-9A-F]{6}$/i)
    expect(screen.getByRole('img', { name: 'Qobuz logo' }).getAttribute('fill')).toBe('none')
  })

  it('describes each service by status and best quality', async () => {
    render(<ConnectionsPage />)
    const qobuz = (await screen.findByRole('img', { name: 'Qobuz logo' })).closest('li')!

    expect(within(qobuz).getByText(/Not connected/)).toBeTruthy()
    expect(within(qobuz).getByText(/FLAC up to 24-bit \/ 192 kHz/)).toBeTruthy()
    const spotify = screen.getByRole('img', { name: 'Spotify logo' }).closest('li')!
    expect(within(spotify).getByText(/OGG-VORBIS up to 320 kbps/)).toBeTruthy()
    expect(screen.getByText('0 of 5 connected')).toBeTruthy()
  })

  it('connects a service and refreshes the list', async () => {
    api.listProviders
      .mockResolvedValueOnce(ALL)
      .mockResolvedValue(ALL.map((p) => (p.id === 'spotify' ? { ...p, connected: true } : p)))
    render(<ConnectionsPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Connect Spotify' }))

    expect(api.connectProvider).toHaveBeenCalledWith('spotify')
    expect(await screen.findByRole('button', { name: 'Disconnect Spotify' })).toBeTruthy()
    expect(screen.getByText('1 of 5 connected')).toBeTruthy()
  })

  it('disconnects a connected service', async () => {
    api.listProviders.mockResolvedValue(ALL.map((p) => (p.id === 'qobuz' ? { ...p, connected: true } : p)))
    render(<ConnectionsPage />)

    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect Qobuz' }))

    expect(api.disconnectProvider).toHaveBeenCalledWith('qobuz')
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
    expect((screen.getByRole('button', { name: 'Connect Qobuz' }) as HTMLButtonElement).disabled).toBe(false)

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
})
