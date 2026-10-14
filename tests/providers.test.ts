import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import { createApi } from '../src/main/ipc/register'
import { createDefaultRegistry } from '../src/main/providers/registry'

describe('provider registry', () => {
  it('lists every planned service as disconnected', async () => {
    const statuses = await createDefaultRegistry().listStatuses()

    expect(statuses.map((s) => s.id)).toEqual(['spotify', 'youtubeMusic', 'tidal', 'local'])
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
    await expect(api.getSavedTracks('tidal')).rejects.toThrow('not implemented')
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
    await expect(api.searchTracks('tidal', 'foo')).rejects.toThrow("TIDAL doesn't support search")
    await expect(api.saveTrack('tidal', 'x')).rejects.toThrow("TIDAL doesn't support saving songs")
    await expect(api.unsaveTrack('tidal', 'x')).rejects.toThrow("TIDAL doesn't support removing saved songs")
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
    expect(statuses.find((s) => s.id === 'tidal')).toMatchObject({ searchable: false, savable: false })
  })

  it('does not call a service that can save but not remove savable', async () => {
    const { provider } = fake({ unsaveTrack: undefined })
    const statuses = await createDefaultRegistry({ spotify: provider as never }).listStatuses()
    expect(statuses.find((s) => s.id === 'spotify')?.savable).toBe(false)
  })
})

describe('api: albums', () => {
  const fake = () => {
    const provider = {
      info: { id: 'spotify', name: 'Spotify', authKind: 'oauth-pkce', playback: 'sdk', maxQuality: { codec: 'ogg', lossless: false } },
      isConnected: vi.fn().mockResolvedValue(true),
      connect: vi.fn(),
      disconnect: vi.fn(),
      getSavedTracks: vi.fn(),
      getArtistAlbums: vi.fn().mockResolvedValue({ albums: [] }),
      getAlbumTracks: vi.fn().mockResolvedValue({ tracks: [] })
    }
    return { provider, api: createApi(createDefaultRegistry({ spotify: provider as never })) }
  }

  it("passes an artist's or album's id and the cursor to the service", async () => {
    const { provider, api } = fake()
    await api.getArtistAlbums('spotify', 'artist-1', '10')
    await api.getAlbumTracks('spotify', 'album-1')
    expect(provider.getArtistAlbums).toHaveBeenCalledExactlyOnceWith('artist-1', '10')
    expect(provider.getAlbumTracks).toHaveBeenCalledExactlyOnceWith('album-1', undefined)
  })

  it.each([['empty', ''], ['not text', 5], ['huge', 'x'.repeat(101)]])('refuses an id that is %s', async (_label, id) => {
    const { provider, api } = fake()
    await expect(api.getArtistAlbums('spotify', id as string)).rejects.toThrow('That is not a valid artist.')
    await expect(api.getAlbumTracks('spotify', id as string)).rejects.toThrow('That is not a valid album.')
    expect(provider.getArtistAlbums).not.toHaveBeenCalled()
    expect(provider.getAlbumTracks).not.toHaveBeenCalled()
  })

  it('refuses a bad cursor', async () => {
    const { provider, api } = fake()
    await expect(api.getAlbumTracks('spotify', 'album-1', 'x'.repeat(501))).rejects.toThrow('Invalid library cursor')
    expect(provider.getAlbumTracks).not.toHaveBeenCalled()
  })

  it('says plainly when a service has no albums, and reports which do', async () => {
    const { provider } = fake()
    await expect(createApi(createDefaultRegistry()).getArtistAlbums('tidal', 'x')).rejects.toThrow("TIDAL doesn't support albums")
    const statuses = await createDefaultRegistry({ spotify: provider as never }).listStatuses()
    expect(statuses.find((s) => s.id === 'spotify')?.albums).toBe(true)
    expect(statuses.find((s) => s.id === 'tidal')?.albums).toBe(false)
  })
})

describe('api: signing in', () => {
  it('signs in with the service itself, passing it nothing from the window', async () => {
    const connect = vi.fn().mockResolvedValue(undefined)
    const provider = { info: { id: 'spotify', name: 'Spotify', authKind: 'oauth-pkce' }, isConnected: async () => false, connect, disconnect: async () => undefined, getSavedTracks: async () => ({ tracks: [] }) }
    await (createApi(createDefaultRegistry({ spotify: provider as never })).connectProvider as (id: string, extra?: unknown) => Promise<void>)('spotify', { username: 'a@b.c', password: 'pw' })
    expect(connect).toHaveBeenCalledExactlyOnceWith()
  })
})
