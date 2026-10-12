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
  provider({ id: 'soundcloud', name: 'SoundCloud' }),
  provider({ id: 'qobuz', name: 'Qobuz', authKind: 'credentials', playback: 'stream', maxQuality: lossless }),
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
    unsaveTrack: vi.fn()
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

  it('renders brand marks as colored icons or image files, with a generic glyph only for local files', async () => {
    render(<ConnectionsPage />)
    await screen.findAllByRole('listitem')

    expect(screen.getByRole('img', { name: 'YouTube logo' }).getAttribute('fill')).toMatch(/^#[0-9A-F]{6}$/i)

    expect(screen.getByRole('img', { name: 'Spotify logo' }).getAttribute('fill')).toMatch(/^#[0-9A-F]{6}$/i)

    const qobuz = screen.getByRole('img', { name: 'Qobuz logo' })
    expect(qobuz.tagName).toBe('IMG')
    expect(qobuz.getAttribute('src')).toBeTruthy()

    expect(screen.getByRole('img', { name: 'Local files logo' }).getAttribute('fill')).toBe('none')
  })

  it('describes each service by status and best quality', async () => {
    render(<ConnectionsPage />)
    const qobuz = (await screen.findByRole('img', { name: 'Qobuz logo' })).closest('li')!

    expect(within(qobuz).getByText(/Not connected/)).toBeTruthy()
    expect(within(qobuz).getByText(/FLAC up to 24-bit \/ 192 kHz/)).toBeTruthy()
    const spotify = screen.getByRole('img', { name: 'Spotify logo' }).closest('li')!
    expect(within(spotify).getByText(/Ogg Vorbis up to 320 kbps/)).toBeTruthy()
    expect(screen.getByText('0 of 5 connected')).toBeTruthy()
  })

  describe('the notice before linking SoundCloud', () => {
    it('tells the user what will be used and why, and signs in only after they continue', async () => {
      api.listProviders
        .mockResolvedValueOnce(ALL)
        .mockResolvedValue(ALL.map((p) => (p.id === 'soundcloud' ? { ...p, connected: true } : p)))
      render(<ConnectionsPage />)

      await userEvent.click(await screen.findByRole('button', { name: 'Connect SoundCloud' }))

      const notice = within(screen.getByRole('listitem', { name: 'Before linking SoundCloud' }))
      expect(notice.getByText(/read the tracks you have liked and search SoundCloud/)).toBeTruthy()
      expect(notice.getByText(/likes or un-likes a track only when you choose to/)).toBeTruthy()
      expect(api.connectProvider).not.toHaveBeenCalled()

      await userEvent.click(notice.getByRole('button', { name: 'Continue to SoundCloud' }))

      expect(api.connectProvider).toHaveBeenCalledExactlyOnceWith('soundcloud')
      expect(await screen.findByRole('button', { name: 'Disconnect SoundCloud' })).toBeTruthy()
      expect(screen.queryByRole('listitem', { name: 'Before linking SoundCloud' })).toBeNull()
    })

    it('goes nowhere when the user cancels', async () => {
      render(<ConnectionsPage />)
      await userEvent.click(await screen.findByRole('button', { name: 'Connect SoundCloud' }))

      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(api.connectProvider).not.toHaveBeenCalled()
      expect(screen.queryByRole('listitem', { name: 'Before linking SoundCloud' })).toBeNull()
    })

    it('is not shown for services that did not ask for one', async () => {
      render(<ConnectionsPage />)
      await userEvent.click(await screen.findByRole('button', { name: 'Connect Spotify' }))
      expect(api.connectProvider).toHaveBeenCalledWith('spotify')
      expect(screen.queryByRole('listitem', { name: /Before linking/ })).toBeNull()
    })
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
      for (const name of ['Spotify', 'Qobuz']) {
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
      api.listProviders.mockResolvedValue(connectedOnly('qobuz'))
      const onChanged = vi.fn()
      render(<ConnectionsPage onChanged={onChanged} />)

      await userEvent.click(await screen.findByRole('button', { name: 'Disconnect Qobuz' }))

      await waitFor(() => expect(onChanged).toHaveBeenCalledExactlyOnceWith('qobuz'))
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

describe('ConnectionsPage signing in with an email and password', () => {
  const NOTICE = 'This application uses the Qobuz API but is not certified by Qobuz.'

  beforeEach(() => {
    api.listProviders.mockResolvedValue(ALL)
  })

  const open = async () => {
    render(<ConnectionsPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Qobuz' }))
    return screen.findByRole('form', { name: 'Sign in to Qobuz' })
  }
  const fill = async (email: string, password: string) => {
    const form = screen.getByRole('form', { name: 'Sign in to Qobuz' })
    await userEvent.type(within(form).getByLabelText('Email'), email)
    await userEvent.type(within(form).getByLabelText('Password'), password)
    return form
  }

  it('shows the notice Qobuz requires on its chip, whether or not anyone signs in', async () => {
    render(<ConnectionsPage />)
    const chip = (await screen.findByRole('img', { name: 'Qobuz logo' })).closest('li')!
    expect(within(chip).getByText(NOTICE)).toBeTruthy()
    expect(screen.getAllByText(NOTICE)).toHaveLength(1)
  })

  it('opens a sign-in form instead of connecting straight away', async () => {
    const form = await open()
    expect(api.connectProvider).not.toHaveBeenCalled()
    expect(within(form).getByLabelText('Email')).toBeTruthy()
    const password = within(form).getByLabelText('Password') as HTMLInputElement
    expect(password.type).toBe('password')
    expect(password.getAttribute('autocomplete')).toBe('current-password')
    expect(document.activeElement).toBe(within(form).getByLabelText('Email'))
  })

  it('says where the details go, with the required notice still showing on the chip above', async () => {
    const form = await open()
    expect(within(form).getByText(/go only to Qobuz, once, and are not stored/)).toBeTruthy()
    expect(screen.getAllByText(NOTICE)).toHaveLength(1)
  })

  it('does not offer to sign in until both fields are filled in', async () => {
    const form = await open()
    const submit = within(form).getByRole('button', { name: 'Sign in' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    await userEvent.type(within(form).getByLabelText('Email'), 'me@example.com')
    expect(submit.disabled).toBe(true)
    await userEvent.type(within(form).getByLabelText('Password'), 'pw')
    expect(submit.disabled).toBe(false)
  })

  it('signs in with what was typed, then closes the form and tells the library to reload that service', async () => {
    const onChanged = vi.fn()
    api.connectProvider.mockResolvedValue(undefined)
    render(<ConnectionsPage onChanged={onChanged} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Qobuz' }))
    await fill('me@example.com', 'hunter2')

    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(api.connectProvider).toHaveBeenCalledExactlyOnceWith('qobuz', { username: 'me@example.com', password: 'hunter2' })
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Sign in to Qobuz' })).toBeNull())
    expect(onChanged).toHaveBeenCalledExactlyOnceWith('qobuz')
  })

  it('also signs in with Enter', async () => {
    api.connectProvider.mockResolvedValue(undefined)
    await open()
    await fill('me@example.com', 'hunter2')
    await userEvent.keyboard('{Enter}')
    expect(api.connectProvider).toHaveBeenCalledOnce()
  })

  it('clears the password as soon as it is sent, but keeps the email', async () => {
    let finish!: () => void
    api.connectProvider.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
    await open()
    const form = await fill('me@example.com', 'hunter2')
    await userEvent.click(within(form).getByRole('button', { name: 'Sign in' }))

    expect((within(form).getByLabelText('Password') as HTMLInputElement).value).toBe('')
    expect((within(form).getByLabelText('Email') as HTMLInputElement).value).toBe('me@example.com')
    finish()
  })

  it('shows what Qobuz said beside the fields when it refuses, and leaves the form open for another try', async () => {
    api.connectProvider.mockRejectedValue(new Error("Error invoking remote method 'providers:connect': Error: Qobuz: Invalid username/email and password combination"))
    await open()
    const form = await fill('me@example.com', 'wrong')
    await userEvent.click(within(form).getByRole('button', { name: 'Sign in' }))

    expect((await within(form).findByRole('alert')).textContent).toBe('Qobuz: Invalid username/email and password combination')
    expect((within(form).getByLabelText('Email') as HTMLInputElement).value).toBe('me@example.com')
    expect((within(form).getByLabelText('Password') as HTMLInputElement).value).toBe('')
    expect(within(form).queryByText('Signing in…')).toBeNull()
    // The page-wide banner is for everything else.
    expect(screen.queryAllByRole('alert')).toHaveLength(1)
  })

  it('never shows the password in an error', async () => {
    api.connectProvider.mockRejectedValue(new Error('Qobuz sign-in failed with status 503'))
    await open()
    const form = await fill('me@example.com', 'hunter2')
    await userEvent.click(within(form).getByRole('button', { name: 'Sign in' }))
    await within(form).findByRole('alert')
    expect(document.body.textContent).not.toContain('hunter2')
  })

  it('waits while signing in', async () => {
    api.connectProvider.mockReturnValue(new Promise(() => undefined))
    await open()
    const form = await fill('me@example.com', 'hunter2')
    await userEvent.click(within(form).getByRole('button', { name: 'Sign in' }))
    expect(await within(form).findByRole('button', { name: 'Signing in…' })).toBeTruthy()
    expect((within(form).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('closes without signing in on Cancel or Escape, and forgets an old error when it is opened again', async () => {
    api.connectProvider.mockRejectedValue(new Error('Qobuz did not accept that email and password.'))
    await open()
    const form = await fill('me@example.com', 'wrong')
    await userEvent.click(within(form).getByRole('button', { name: 'Sign in' }))
    await within(form).findByRole('alert')

    await userEvent.click(within(form).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: 'Sign in to Qobuz' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Connect Qobuz' }))
    const again = await screen.findByRole('form', { name: 'Sign in to Qobuz' })
    expect(within(again).queryByRole('alert')).toBeNull()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('form', { name: 'Sign in to Qobuz' })).toBeNull()
    expect(api.connectProvider).toHaveBeenCalledTimes(1)
  })

  it('closes the form when Connect is pressed a second time', async () => {
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Connect Qobuz' }))
    expect(screen.queryByRole('form', { name: 'Sign in to Qobuz' })).toBeNull()
  })

  it('does not open a form for a service that signs in in a browser, and gives it no credentials', async () => {
    api.connectProvider.mockResolvedValue(undefined)
    render(<ConnectionsPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Connect Spotify' }))
    expect(screen.queryByRole('form')).toBeNull()
    expect(api.connectProvider).toHaveBeenCalledExactlyOnceWith('spotify')
  })

  it('disconnects a signed-in account without asking for a password', async () => {
    api.listProviders.mockResolvedValue(ALL.map((p) => (p.id === 'qobuz' ? { ...p, connected: true } : p)))
    api.disconnectProvider.mockResolvedValue(undefined)
    render(<ConnectionsPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Disconnect Qobuz' }))
    expect(screen.queryByRole('form')).toBeNull()
    expect(api.disconnectProvider).toHaveBeenCalledWith('qobuz')
  })
})
