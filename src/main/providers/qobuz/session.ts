import type { TokenSet } from '@shared/types'
import { AuthRequiredError } from '../../auth/session'
import type { TokenStore } from '../../auth/tokenStore'
import { QOBUZ_API, type QobuzApp } from './config'

/** What the account's subscription lets it stream, best first. */
export type QobuzTier = 'hires' | 'lossless' | 'lossy' | 'none'

const MAX_ERROR_MESSAGE_LENGTH = 200
/** Qobuz doesn't say when a sign-in token lapses; the first request it refuses ends the sign-in. */
const NOMINAL_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000

interface LoginResponse {
  user_auth_token?: unknown
  user?: { credential?: { parameters?: { hires_streaming?: unknown; lossless_streaming?: unknown; lossy_streaming?: unknown } } }
  message?: unknown
}

export interface QobuzSessionDeps {
  app: () => QobuzApp
  store: TokenStore
  fetch: typeof fetch
  now(): number
}

/** The tier a login response says the account has, from the streaming rights in its credential. */
export function tierOf(response: LoginResponse): QobuzTier {
  const rights = response.user?.credential?.parameters
  if (rights?.hires_streaming === true) return 'hires'
  if (rights?.lossless_streaming === true) return 'lossless'
  if (rights?.lossy_streaming === true) return 'lossy'
  return 'none'
}

/**
 * One Qobuz account's sign-in. Qobuz has no browser sign-in for applications, so the user's own email and
 * password are sent to it, over https and in a request body (never in a URL), once; only the token it returns
 * is kept, encrypted. The password is not stored, logged or put in any message.
 */
export class QobuzSession {
  constructor(private readonly deps: QobuzSessionDeps) {}

  async isConnected(): Promise<boolean> {
    return (await this.deps.store.get('qobuz')) !== undefined
  }

  /** What the signed-in account may stream, or `none` when nobody is signed in. */
  async tier(): Promise<QobuzTier> {
    const scope = (await this.deps.store.get('qobuz'))?.scope
    return scope === 'hires' || scope === 'lossless' || scope === 'lossy' ? scope : 'none'
  }

  async signIn(username: string, password: string): Promise<void> {
    const { appId } = this.deps.app()
    const response = await this.deps.fetch(`${QOBUZ_API}/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'X-App-Id': appId },
      body: new URLSearchParams({ username, password, app_id: appId })
    })

    let body: LoginResponse = {}
    try {
      body = (await response.json()) as LoginResponse
    } catch {
      // Not JSON: the status below says enough.
    }
    if (!response.ok) throw new Error(describeFailure(response.status, body))

    const token = body.user_auth_token
    if (typeof token !== 'string' || !token) throw new Error('Qobuz did not return a sign-in. Try again.')
    const tokens: TokenSet = { accessToken: token, expiresAt: this.deps.now() + NOMINAL_LIFETIME_MS, scope: tierOf(body) }
    await this.deps.store.set('qobuz', tokens)
  }

  async signOut(): Promise<void> {
    await this.deps.store.delete('qobuz')
  }

  /** The token to send with a request, or an error asking the user to sign in again. */
  async getToken(): Promise<string> {
    const tokens = await this.deps.store.get('qobuz')
    if (!tokens) throw new AuthRequiredError('Qobuz')
    return tokens.accessToken
  }

  /** Qobuz refused the token: the sign-in is over, and the user must sign in again. */
  async expire(): Promise<never> {
    await this.signOut()
    throw new AuthRequiredError('Qobuz')
  }
}

function describeFailure(status: number, body: LoginResponse): string {
  const message = typeof body.message === 'string' ? body.message.replace(/\p{Cc}/gu, ' ').trim().slice(0, MAX_ERROR_MESSAGE_LENGTH) : ''
  if (message) return `Qobuz: ${message}`
  return status === 400 || status === 401 || status === 403 ? 'Qobuz did not accept that email and password.' : `Qobuz sign-in failed with status ${status}`
}
