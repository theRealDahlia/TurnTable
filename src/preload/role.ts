export type PreloadRole = 'app' | 'spotify-player' | 'tidal-player'

const SPOTIFY_PAGE = 'spotify-player.html'
const TIDAL_PAGE = 'tidal-player.html'

/** Which window a preload is running in, judged by the page it was loaded for. */
export function roleForPath(pathname: string): PreloadRole {
  const page = pathname.split('/').pop()
  if (page === SPOTIFY_PAGE) return 'spotify-player'
  if (page === TIDAL_PAGE) return 'tidal-player'
  return 'app'
}
