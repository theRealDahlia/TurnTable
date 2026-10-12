import white from '../assets/logos/spotify-full-white.svg'
import black from '../assets/logos/spotify-full-black.svg'

/**
 * Spotify's full logo, as its guidelines ask wherever its content appears. The official files are used
 * as they are, in the monochrome version that suits the theme (the green one is for pure black or white only).
 */
export function SpotifyFullLogo({ size = 'md' }: { size?: 'md' | 'sm' }): React.JSX.Element {
  return (
    <span className={size === 'sm' ? 'spotify-full spotify-full-sm' : 'spotify-full'}>
      <img className="spotify-full-on-dark" src={white} alt="Spotify logo" />
      <img className="spotify-full-on-light" src={black} alt="" aria-hidden="true" />
    </span>
  )
}
