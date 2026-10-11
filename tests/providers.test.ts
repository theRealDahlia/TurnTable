import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import { createApi } from '../src/main/ipc/register'
import { createDefaultRegistry } from '../src/main/providers/registry'

describe('provider registry', () => {
  it('lists every planned service as disconnected', async () => {
    const statuses = await createDefaultRegistry().listStatuses()

    expect(statuses.map((s) => s.id)).toEqual(['spotify', 'youtubeMusic', 'soundcloud', 'qobuz', 'local'])
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
