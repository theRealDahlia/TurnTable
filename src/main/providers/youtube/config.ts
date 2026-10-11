import type { OAuthConfig } from '../../auth/oauth'

/**
 * What listing the account's liked videos and liking or un-liking one needs. Liking is the one thing here
 * that writes, and YouTube only offers it behind this scope (which also covers reading); the narrower
 * read-only scope can't rate videos. YouTube Music has no API of its own; its likes are the account's YouTube likes.
 */
export const YOUTUBE_SCOPES = ['https://www.googleapis.com/auth/youtube.force-ssl']

/**
 * Google accepts any loopback port for a "Desktop app" client, so sign-in uses a free one (RFC 8252) and no
 * redirect URI has to be registered.
 */
export function youtubeOAuthConfig(clientId: string | undefined, clientSecret?: string): OAuthConfig {
  if (!clientId) {
    throw new Error(
      'YouTube Music is not set up: add your Google OAuth client ID to .env as MAIN_VITE_YOUTUBE_CLIENT_ID (see README).'
    )
  }
  return {
    clientId,
    clientSecret: clientSecret || undefined,
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: YOUTUBE_SCOPES,
    // Without these Google may omit the refresh token on a repeat sign-in, which would end the session in an hour.
    extraAuthParams: { access_type: 'offline', prompt: 'consent' }
  }
}
