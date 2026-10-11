import { describe, expect, it } from 'vitest'
import { roleForPath } from '../src/preload/role'

describe('roleForPath', () => {
  it.each([
    ['/Users/me/TurnTable/out/renderer/spotify-player.html', 'spotify-player'],
    ['/spotify-player.html', 'spotify-player'],
    ['/Users/me/TurnTable/out/renderer/index.html', 'app'],
    ['/', 'app'],
    ['', 'app'],
    ['/index.html', 'app']
  ])('treats %j as the %s window', (pathname, role) => {
    expect(roleForPath(pathname)).toBe(role)
  })

  it.each(['/not-spotify-player.html', '/spotify-player.html.evil', '/a/spotify-player.html/b', '/spotify-player.htm'])(
    'does not mistake %j for the player page',
    (pathname) => {
      expect(roleForPath(pathname)).toBe('app')
    }
  )
})
