import { describe, expect, it } from 'vitest'
import { COLLECTION_SCOPES, PLAYBACK_SCOPES, SEARCH_SCOPES, TIDAL_API, TIDAL_REDIRECT_PORT, TIDAL_SCOPES, tidalOAuthConfig } from '../src/main/providers/tidal/config'

describe('TIDAL sign-in configuration', () => {
  it('signs in with PKCE at TIDAL, on one fixed loopback port that is registered with the app', () => {
    const config = tidalOAuthConfig('client-123')
    expect(config).toEqual({
      clientId: 'client-123',
      authorizeUrl: 'https://login.tidal.com/authorize',
      tokenUrl: 'https://auth.tidal.com/v1/oauth2/token',
      scopes: ['collection.read', 'collection.write', 'search.read', 'playback'],
      loopbackPort: TIDAL_REDIRECT_PORT
    })
    expect(config).not.toHaveProperty('clientSecret')
    expect(TIDAL_REDIRECT_PORT).toBe(43824)
  })

  it('asks only for what saving, reading and searching need, and nothing from the internal tier', () => {
    expect(TIDAL_SCOPES).toEqual([...COLLECTION_SCOPES, ...SEARCH_SCOPES, ...PLAYBACK_SCOPES])
    for (const scope of TIDAL_SCOPES) expect(['r_usr', 'w_usr']).not.toContain(scope)
  })

  it('talks to TIDAL over https', () => {
    expect(TIDAL_API).toBe('https://openapi.tidal.com/v2')
  })

  it('says how to set it up when there is no client ID', () => {
    expect(() => tidalOAuthConfig(undefined)).toThrow('MAIN_VITE_TIDAL_CLIENT_ID')
    expect(() => tidalOAuthConfig('')).toThrow('TIDAL is not set up')
  })
})
