import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface LoopbackResult {
  code: string
  state: string
}

export interface LoopbackServer {
  redirectUri: string
  result: Promise<LoopbackResult>
  close(): void
}

export interface LoopbackOptions {
  /** Fixed port, for services that require a pre-registered redirect URI. 0 picks a free one. */
  port?: number
  timeoutMs?: number
}

const CALLBACK_PATH = '/callback'
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

const PAGE = (message: string): string =>
  `<!doctype html><meta charset="utf-8"><title>TurnTable</title><p style="font-family:system-ui">${message}</p>`

/**
 * Starts a one-shot HTTP server on 127.0.0.1 that receives an OAuth redirect
 * (RFC 8252 loopback flow). It shuts itself down after the first valid
 * callback, an error callback, or the timeout.
 */
export async function startLoopbackServer(options: LoopbackOptions = {}): Promise<LoopbackServer> {
  const { port = 0, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  let server: Server

  const result = new Promise<LoopbackResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      server.close()
      reject(new Error('Timed out waiting for the sign-in to complete'))
    }, timeoutMs)

    server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end()
        return
      }

      const error = url.searchParams.get('error')
      const code = url.searchParams.get('code')
      const state = url.searchParams.get('state')

      if (!error && !(code && state)) {
        res.writeHead(400, { 'Content-Type': 'text/html' }).end(PAGE('Invalid sign-in response.'))
        return
      }

      clearTimeout(timer)
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(PAGE(error ? 'Sign-in failed. You can close this tab.' : 'Signed in. You can close this tab.'))
      server.close()
      server.closeAllConnections()

      if (error) reject(new Error(`Authorization failed: ${error}`))
      else resolve({ code: code as string, state: state as string })
    })
    server.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
  // The caller may attach handlers later; surface failures there, not as an unhandled rejection.
  result.catch(() => undefined)

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const { port: boundPort } = server!.address() as AddressInfo

  return {
    redirectUri: `http://127.0.0.1:${boundPort}${CALLBACK_PATH}`,
    result,
    close: () => {
      server.close()
      server.closeAllConnections()
    }
  }
}
