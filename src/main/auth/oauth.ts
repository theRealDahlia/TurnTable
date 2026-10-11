import type { TokenSet } from '@shared/types'
import { startLoopbackServer } from './loopback'
import { createCodeChallenge, generateCodeVerifier, generateState } from './pkce'

export interface OAuthConfig {
  clientId: string
  /**
   * Only for services that insist on one even for native apps (Google's "Desktop app" clients); it is
   * not confidential there, and PKCE still protects the exchange. Spotify and others leave it out.
   */
  clientSecret?: string
  authorizeUrl: string
  tokenUrl: string
  scopes: string[]
  /** Extra query parameters some services require on the authorize request. */
  extraAuthParams?: Record<string, string>
  /** Fixed loopback port, if the service needs the redirect URI registered in advance. */
  loopbackPort?: number
}

export interface OAuthDeps {
  /** Opens the authorization URL in the user's default browser. */
  openUrl(url: string): Promise<void>
  fetch: typeof fetch
  now(): number
}

interface TokenResponse {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
}

/** The token endpoint rejected a request. `status` lets callers tell a revoked grant (400/401) from an outage. */
export class TokenRequestError extends Error {
  constructor(readonly status: number) {
    super(`Token request failed with status ${status}`)
    this.name = 'TokenRequestError'
  }
}

/** OAuth 2.0 authorization-code flow with PKCE for native apps (RFC 7636 / RFC 8252). */
export class OAuthClient {
  constructor(private readonly deps: OAuthDeps) {}

  async authorize(config: OAuthConfig): Promise<TokenSet> {
    const verifier = generateCodeVerifier()
    const state = generateState()
    const loopback = await startLoopbackServer({ port: config.loopbackPort })

    try {
      const url = new URL(config.authorizeUrl)
      url.search = new URLSearchParams({
        ...config.extraAuthParams,
        response_type: 'code',
        client_id: config.clientId,
        redirect_uri: loopback.redirectUri,
        scope: config.scopes.join(' '),
        state,
        code_challenge_method: 'S256',
        code_challenge: createCodeChallenge(verifier)
      }).toString()
      await this.deps.openUrl(url.toString())

      const callback = await loopback.result
      if (callback.state !== state) throw new Error('Authorization response state did not match')

      return await this.requestTokens(config, {
        grant_type: 'authorization_code',
        code: callback.code,
        redirect_uri: loopback.redirectUri,
        code_verifier: verifier
      })
    } finally {
      loopback.close()
    }
  }

  /** Exchanges a refresh token for a new access token, keeping the old refresh token if none is returned. */
  async refresh(config: OAuthConfig, refreshToken: string): Promise<TokenSet> {
    const tokens = await this.requestTokens(config, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })
    return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken }
  }

  private async requestTokens(config: OAuthConfig, params: Record<string, string>): Promise<TokenSet> {
    const response = await this.deps.fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        ...params,
        client_id: config.clientId,
        ...(config.clientSecret ? { client_secret: config.clientSecret } : {})
      })
    })
    if (!response.ok) throw new TokenRequestError(response.status)

    const body = (await response.json()) as TokenResponse
    if (!body.access_token) throw new Error('Token response did not include an access token')

    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: this.deps.now() + (body.expires_in ?? 3600) * 1000,
      scope: body.scope
    }
  }
}
