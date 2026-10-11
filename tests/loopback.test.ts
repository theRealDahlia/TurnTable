import { describe, expect, it } from 'vitest'
import { startLoopbackServer } from '../src/main/auth/loopback'

describe('startLoopbackServer', () => {
  it('resolves with the code and state from the redirect', async () => {
    const server = await startLoopbackServer()
    expect(server.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/)

    const response = await fetch(`${server.redirectUri}?code=abc&state=xyz`)
    expect(response.status).toBe(200)
    await expect(server.result).resolves.toEqual({ code: 'abc', state: 'xyz' })
  })

  it('rejects when the service reports an error', async () => {
    const server = await startLoopbackServer()
    await fetch(`${server.redirectUri}?error=access_denied`)
    await expect(server.result).rejects.toThrow('access_denied')
  })

  it('ignores other paths and incomplete callbacks, then still accepts a valid one', async () => {
    const server = await startLoopbackServer()
    expect((await fetch(server.redirectUri.replace('/callback', '/other'))).status).toBe(404)
    expect((await fetch(`${server.redirectUri}?code=only-code`)).status).toBe(400)

    await fetch(`${server.redirectUri}?code=abc&state=xyz`)
    await expect(server.result).resolves.toEqual({ code: 'abc', state: 'xyz' })
  })

  it('times out when no callback arrives', async () => {
    const server = await startLoopbackServer({ timeoutMs: 20 })
    await expect(server.result).rejects.toThrow('Timed out')
  })

  it('fails to start when the port is already in use', async () => {
    const first = await startLoopbackServer()
    const port = Number(new URL(first.redirectUri).port)
    await expect(startLoopbackServer({ port })).rejects.toThrow(`Port ${port} is already in use`)
    first.close()
  })
})
