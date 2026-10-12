import type { OAuthConfig } from '../../auth/oauth'

/**
 * Fixed because Spotify's dashboard rejects a portless loopback URI as insecure, so the exact URI
 * `http://127.0.0.1:43821/callback` must be registered in the Spotify app. Change both together.
 */
export const SPOTIFY_REDIRECT_PORT = 43821

/**
 * What the Web Playback SDK needs (`streaming`, plus the profile scopes it checks the account with; without
 * them it fails with "Invalid token scopes") and starting a track on its device (`user-modify-playback-state`).
 */
export const PLAYBACK_SCOPES = ['streaming', 'user-read-email', 'user-read-private', 'user-modify-playback-state']

/** What saving songs to the library, and removing them again, needs. */
export const LIBRARY_WRITE_SCOPES = ['user-library-modify']

/** What the app needs beyond reading the library; a grant without all of these must be renewed. */
export const REQUIRED_SCOPES = [...PLAYBACK_SCOPES, ...LIBRARY_WRITE_SCOPES]

/** The minimum for reading the library, playing it and saving to it, and nothing broader. */
const SCOPES = ['user-library-read', ...REQUIRED_SCOPES]

export function spotifyOAuthConfig(clientId: string | undefined): OAuthConfig {
  if (!clientId) {
    throw new Error(
      'Spotify is not set up: add your Spotify app\'s client ID to .env as MAIN_VITE_SPOTIFY_CLIENT_ID (see README).'
    )
  }
  return {
    clientId,
    authorizeUrl: 'https://accounts.spotify.com/authorize',
    tokenUrl: 'https://accounts.spotify.com/api/token',
    scopes: SCOPES,
    loopbackPort: SPOTIFY_REDIRECT_PORT
  }
}
