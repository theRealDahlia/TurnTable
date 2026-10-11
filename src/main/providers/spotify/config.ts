import type { OAuthConfig } from '../../auth/oauth'

/** Only what the library needs. Playback scopes are requested when playback is built. */
const SCOPES = ['user-library-read']

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
    scopes: SCOPES
  }
}
