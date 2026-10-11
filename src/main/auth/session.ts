import type { ProviderId, TokenSet } from '@shared/types'
import { TokenRequestError, type OAuthClient, type OAuthConfig } from './oauth'
import type { TokenStore } from './tokenStore'

/** Refresh slightly early so a token never expires between being handed out and being used. */
const REFRESH_MARGIN_MS = 60_000

/** The user has no usable session and must sign in again. */
export class AuthRequiredError extends Error {
  constructor(serviceName: string) {
    super(`${serviceName} session expired. Please reconnect.`)
    this.name = 'AuthRequiredError'
  }
}

export interface OAuthSessionDeps {
  providerId: ProviderId
  serviceName: string
  /** A function so a missing client id surfaces when the user clicks Connect, not at startup. */
  config: () => OAuthConfig
  oauth: OAuthClient
  store: TokenStore
  now(): number
}

/** One service's sign-in state: persists tokens and hands out fresh access tokens. */
export class OAuthSession {
  private refreshing?: Promise<TokenSet>

  constructor(private readonly deps: OAuthSessionDeps) {}

  async isConnected(): Promise<boolean> {
    return (await this.deps.store.get(this.deps.providerId)) !== undefined
  }

  async connect(): Promise<void> {
    const tokens = await this.deps.oauth.authorize(this.deps.config())
    await this.deps.store.set(this.deps.providerId, tokens)
  }

  async disconnect(): Promise<void> {
    await this.deps.store.delete(this.deps.providerId)
  }

  /** Returns a valid access token, refreshing it first if it is expired or about to be. */
  async getAccessToken({ forceRefresh = false } = {}): Promise<string> {
    const tokens = await this.deps.store.get(this.deps.providerId)
    if (!tokens) throw this.authRequired()

    if (!forceRefresh && tokens.expiresAt - this.deps.now() > REFRESH_MARGIN_MS) return tokens.accessToken
    if (!tokens.refreshToken) {
      await this.disconnect()
      throw this.authRequired()
    }
    return (await this.refresh(tokens.refreshToken)).accessToken
  }

  /** Concurrent callers share one refresh, since a rotating refresh token can only be used once. */
  private refresh(refreshToken: string): Promise<TokenSet> {
    this.refreshing ??= this.doRefresh(refreshToken).finally(() => {
      this.refreshing = undefined
    })
    return this.refreshing
  }

  private async doRefresh(refreshToken: string): Promise<TokenSet> {
    try {
      const tokens = await this.deps.oauth.refresh(this.deps.config(), refreshToken)
      await this.deps.store.set(this.deps.providerId, tokens)
      return tokens
    } catch (error) {
      // A rejected grant is permanent; anything else (network, 5xx) may succeed later, so keep the tokens.
      if (error instanceof TokenRequestError && (error.status === 400 || error.status === 401)) {
        await this.disconnect()
        throw this.authRequired()
      }
      throw error
    }
  }

  private authRequired(): AuthRequiredError {
    return new AuthRequiredError(this.deps.serviceName)
  }
}
