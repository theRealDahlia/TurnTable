import { describe, expect, it, vi } from 'vitest'
import type { OAuthSession } from '../src/main/auth/session'
import { createYouTubeProvider } from '../src/main/providers/youtube/provider'

function setup() {
  const session = {
    isConnected: vi.fn().mockResolvedValue(true),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined)
  }
  return { session, provider: createYouTubeProvider(session as unknown as OAuthSession) }
}

describe('YouTube Music sign-in', () => {
  it('describes itself as YouTube Music', () => {
    expect(setup().provider.info).toMatchObject({ id: 'youtubeMusic', name: 'YouTube Music', authKind: 'oauth-pkce' })
  })

  it('hands sign-in, sign-out and connection state to its session', async () => {
    const { session, provider } = setup()

    await provider.connect()
    await provider.disconnect()

    expect(session.connect).toHaveBeenCalledOnce()
    expect(session.disconnect).toHaveBeenCalledOnce()
    await expect(provider.isConnected()).resolves.toBe(true)
  })
})
