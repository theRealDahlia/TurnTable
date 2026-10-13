import type { OAuthConfig } from '../../auth/oauth'

/**
 * TIDAL has the redirect URIs registered with the app in advance, so sign-in uses one fixed port:
 * `http://127.0.0.1:43824/callback` must be registered in the TIDAL developer dashboard. Change both together.
 */
export const TIDAL_REDIRECT_PORT = 43824

/** Where TIDAL's API lives. Every response is JSON:API (`application/vnd.api+json`). */
export const TIDAL_API = 'https://openapi.tidal.com/v2'

/** Reading the user's saved tracks, and saving or removing one. Nothing broader is asked for. */
export const COLLECTION_SCOPES = ['collection.read', 'collection.write']

/** Playing TIDAL's audio, which TIDAL's own player does on the user's behalf. */
export const PLAYBACK_SCOPES = ['playback']

/** Searching the catalog on the user's behalf. */
export const SEARCH_SCOPES = ['search.read']

/** What the app needs; a grant without all of these must be renewed. */
export const TIDAL_SCOPES = [...COLLECTION_SCOPES, ...SEARCH_SCOPES, ...PLAYBACK_SCOPES]

export function tidalOAuthConfig(clientId: string | undefined): OAuthConfig {
  if (!clientId) {
    throw new Error('TIDAL is not set up: add your TIDAL app\'s client ID to .env as MAIN_VITE_TIDAL_CLIENT_ID (see README).')
  }
  return {
    clientId,
    // Authorization Code with PKCE, as TIDAL's API documents for apps acting for a user. No client secret is used.
    authorizeUrl: 'https://login.tidal.com/authorize',
    tokenUrl: 'https://auth.tidal.com/v1/oauth2/token',
    scopes: TIDAL_SCOPES,
    loopbackPort: TIDAL_REDIRECT_PORT
  }
}
