import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import { createApi } from '../src/main/ipc/register'
import { createDefaultRegistry } from '../src/main/providers/registry'

describe('provider registry', () => {
  it('lists every planned service as disconnected', async () => {
    const statuses = await createDefaultRegistry().listStatuses()

    expect(statuses.map((s) => s.id)).toEqual(['spotify', 'youtubeMusic', 'qobuz', 'local'])
    expect(statuses.every((s) => !s.connected)).toBe(true)
  })

  it('rejects unknown provider ids', () => {
    expect(() => createDefaultRegistry().get('napster')).toThrow('Unknown provider')
  })
})

describe('api', () => {
  it('reports unfinished integrations clearly instead of returning fake data', async () => {
    const api = createApi(createDefaultRegistry())

    await expect(api.connectProvider('spotify')).rejects.toThrow('not implemented')
    await expect(api.getSavedTracks('qobuz')).rejects.toThrow('not implemented')
  })

  it('rejects ids that did not come from the known set', async () => {
    const api = createApi(createDefaultRegistry())
    await expect(api.connectProvider('../etc' as never)).rejects.toThrow('Unknown provider')
  })

  it('disconnecting a placeholder is a harmless no-op', async () => {
    await expect(createApi(createDefaultRegistry()).disconnectProvider('spotify')).resolves.toBeUndefined()
  })
})

describe('api: search and saving', () => {
  const fake = (extra: Record<string, unknown> = {}) => {
    const provider = {
      info: { id: 'spotify', name: 'Spotify' },
      isConnected: async () => true,
      connect: async () => undefined,
      disconnect: async () => undefined,
      getSavedTracks: async () => ({ tracks: [] }),
      search: vi.fn().mockResolvedValue({ tracks: [], nextCursor: undefined }),
      saveTrack: vi.fn().mockResolvedValue(undefined),
      unsaveTrack: vi.fn().mockResolvedValue(undefined),
      ...extra
    }
    return { provider, api: createApi(createDefaultRegistry({ spotify: provider as never })) }
  }

  it('passes a trimmed query and cursor to the service', async () => {
    const { provider, api } = fake()
    await api.searchTracks('spotify', '  foo fighters ', '10')
    expect(provider.search).toHaveBeenCalledExactlyOnceWith('foo fighters', '10')
  })

  it.each([['an empty query', ''], ['a blank query', '   '], ['a query that is not text', 42], ['a huge query', 'x'.repeat(201)]])('refuses %s', async (_label, query) => {
    const { provider, api } = fake()
    await expect(api.searchTracks('spotify', query as string)).rejects.toThrow(/search/i)
    expect(provider.search).not.toHaveBeenCalled()
  })

  it('refuses a cursor that is not text, or is absurdly long', async () => {
    const { provider, api } = fake()
    await expect(api.searchTracks('spotify', 'foo', 5 as never)).rejects.toThrow('Invalid library cursor')
    await expect(api.searchTracks('spotify', 'foo', 'x'.repeat(501))).rejects.toThrow('Invalid library cursor')
    expect(provider.search).not.toHaveBeenCalled()
  })

  it('saves and removes tracks through the service', async () => {
    const { provider, api } = fake()
    await api.saveTrack('spotify', 'track-1')
    await api.unsaveTrack('spotify', 'track-1')
    expect(provider.saveTrack).toHaveBeenCalledExactlyOnceWith('track-1')
    expect(provider.unsaveTrack).toHaveBeenCalledExactlyOnceWith('track-1')
  })

  it.each([['empty', ''], ['not text', 5], ['huge', 'x'.repeat(101)]])('refuses a track id that is %s', async (_label, id) => {
    const { provider, api } = fake()
    await expect(api.saveTrack('spotify', id as string)).rejects.toThrow('not a valid track')
    await expect(api.unsaveTrack('spotify', id as string)).rejects.toThrow('not a valid track')
    expect(provider.saveTrack).not.toHaveBeenCalled()
  })

  it('says plainly when a service cannot do it, instead of failing with a TypeError', async () => {
    const api = createApi(createDefaultRegistry())
    await expect(api.searchTracks('qobuz', 'foo')).rejects.toThrow("Qobuz doesn't support search")
    await expect(api.saveTrack('qobuz', 'x')).rejects.toThrow("Qobuz doesn't support saving songs")
    await expect(api.unsaveTrack('qobuz', 'x')).rejects.toThrow("Qobuz doesn't support removing saved songs")
  })

  it('rejects unknown services', async () => {
    const api = createApi(createDefaultRegistry())
    await expect(api.searchTracks('napster' as never, 'foo')).rejects.toThrow('Unknown provider')
    await expect(api.saveTrack('napster' as never, 'x')).rejects.toThrow('Unknown provider')
  })

  it('reports in each status whether a service can be searched and saved to', async () => {
    const { provider } = fake()
    const statuses = await createDefaultRegistry({ spotify: provider as never }).listStatuses()
    expect(statuses.find((s) => s.id === 'spotify')).toMatchObject({ searchable: true, savable: true })
    expect(statuses.find((s) => s.id === 'qobuz')).toMatchObject({ searchable: false, savable: false })
  })

  it('does not call a service that can save but not remove savable', async () => {
    const { provider } = fake({ unsaveTrack: undefined })
    const statuses = await createDefaultRegistry({ spotify: provider as never }).listStatuses()
    expect(statuses.find((s) => s.id === 'spotify')?.savable).toBe(false)
  })
})

describe('api: signing in with credentials', () => {
  const fake = () => {
    const connect = vi.fn().mockResolvedValue(undefined)
    const provider = {
      info: { id: 'qobuz', name: 'Qobuz', authKind: 'credentials' },
      isConnected: async () => false,
      connect,
      disconnect: async () => undefined,
      getSavedTracks: async () => ({ tracks: [] })
    }
    return { connect, api: createApi(createDefaultRegistry({ qobuz: provider as never })) }
  }

  it('passes the account\'s details on to a service that signs in with them, trimming the email only', async () => {
    const { connect, api } = fake()
    await api.connectProvider('qobuz', { username: '  me@example.com ', password: ' p w ' })
    expect(connect).toHaveBeenCalledExactlyOnceWith({ username: 'me@example.com', password: ' p w ' })
  })

  it.each([
    ['nothing', undefined],
    ['no password', { username: 'me@example.com' }],
    ['no email', { password: 'pw' }],
    ['a blank email', { username: '   ', password: 'pw' }],
    ['an empty password', { username: 'me@example.com', password: '' }],
    ['details that are not text', { username: 5, password: {} }],
    ['something that is not an object', 'me@example.com:pw']
  ])('asks for the email and password when given %s, without calling the service', async (_label, credentials) => {
    const { connect, api } = fake()
    await expect(api.connectProvider('qobuz', credentials as never)).rejects.toThrow('Enter your Qobuz email and password.')
    expect(connect).not.toHaveBeenCalled()
  })

  it('refuses absurdly long details', async () => {
    const { connect, api } = fake()
    await expect(api.connectProvider('qobuz', { username: 'x'.repeat(257), password: 'pw' })).rejects.toThrow('too long')
    await expect(api.connectProvider('qobuz', { username: 'a@b.c', password: 'x'.repeat(257) })).rejects.toThrow('too long')
    expect(connect).not.toHaveBeenCalled()
  })

  it('never repeats the password in an error', async () => {
    const { api } = fake()
    const error = (await api.connectProvider('qobuz', { username: 'x'.repeat(257), password: 'secret-pw' }).catch((e: unknown) => e)) as Error
    expect(error.message).not.toContain('secret-pw')
  })

  it('does not hand credentials to a service that signs in in a browser', async () => {
    const connect = vi.fn().mockResolvedValue(undefined)
    const provider = { info: { id: 'spotify', name: 'Spotify', authKind: 'oauth-pkce' }, isConnected: async () => false, connect, disconnect: async () => undefined, getSavedTracks: async () => ({ tracks: [] }) }
    await createApi(createDefaultRegistry({ spotify: provider as never })).connectProvider('spotify', { username: 'a@b.c', password: 'pw' })
    expect(connect).toHaveBeenCalledExactlyOnceWith()
  })
})
