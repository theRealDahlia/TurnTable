import type { OAuthConfig } from '../../auth/oauth'

/**
 * Fixed because the redirect URI has to be registered with SoundCloud exactly as it is used:
 * `http://127.0.0.1:43823/callback`. Change both together.
 */
export const SOUNDCLOUD_REDIRECT_PORT = 43823

export const SOUNDCLOUD_AUTHORIZE_URL = 'https://secure.soundcloud.com/authorize'
export const SOUNDCLOUD_TOKEN_URL = 'https://secure.soundcloud.com/oauth/token'
export const SOUNDCLOUD_API = 'https://api.soundcloud.com'

/**
 * Authorization Code with PKCE. SoundCloud has no scopes, and treats every app as confidential, so the client
 * secret goes with the client id (it stays in the main process and is never sent to a page).
 */
export function soundcloudOAuthConfig(clientId: string | undefined, clientSecret: string | undefined): OAuthConfig {
  if (!clientId || !clientSecret) {
    throw new Error(
      'SoundCloud is not set up: add your SoundCloud app\'s client ID and secret to .env as MAIN_VITE_SOUNDCLOUD_CLIENT_ID and MAIN_VITE_SOUNDCLOUD_CLIENT_SECRET (see README).'
    )
  }
  return {
    clientId,
    clientSecret,
    authorizeUrl: SOUNDCLOUD_AUTHORIZE_URL,
    tokenUrl: SOUNDCLOUD_TOKEN_URL,
    scopes: [],
    loopbackPort: SOUNDCLOUD_REDIRECT_PORT
  }
}
