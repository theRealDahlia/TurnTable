export type PreloadRole = 'app' | 'spotify-player'

const PLAYER_PAGE = 'spotify-player.html'

/** Which window a preload is running in, judged by the page it was loaded for. */
export function roleForPath(pathname: string): PreloadRole {
  return pathname.split('/').pop() === PLAYER_PAGE ? 'spotify-player' : 'app'
}
