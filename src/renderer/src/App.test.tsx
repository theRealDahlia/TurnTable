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

let api: { [K in keyof TurnTableApi]: ReturnType<typeof vi.fn> }

beforeEach(() => {
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
})
