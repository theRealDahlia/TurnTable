import { siTidal, siYoutube } from 'simple-icons'
import type { ProviderId } from '@shared/types'
import qobuzLogo from '../assets/logos/qobuz.svg'
import spotifyIconBlack from '../assets/logos/spotify-icon-black.svg'
import spotifyIconWhite from '../assets/logos/spotify-icon-white.svg'

interface BrandIcon {
  path: string
  hex: string
}

/** Official marks from Simple Icons (CC0 data; the marks remain their owners' trademarks). */
const BRAND_ICONS: Partial<Record<ProviderId, BrandIcon>> = {
  youtubeMusic: siYoutube,
  tidal: siTidal
}

/** Brand marks Simple Icons doesn't carry, shipped as image files. */
const BRAND_IMAGES: Partial<Record<ProviderId, string>> = {
  qobuz: qobuzLogo
}

/** Generic music-note glyph for local files. */
const NOTE_PATH = 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'

interface Props {
  id: ProviderId
  name: string
  size?: 'md' | 'sm'
}

export function ProviderLogo({ id, name, size = 'md' }: Props): React.JSX.Element {
  const brand = BRAND_ICONS[id]
  const image = BRAND_IMAGES[id]

  return (
    <span className={size === 'sm' ? 'logo logo-sm' : 'logo'} data-provider={id}>
      {id === 'spotify' ? (
        // Spotify's own icon files, unmodified. Its guidelines allow the green one only on pure black or white,
        // and these backgrounds are neither, so the monochrome one that suits the theme is used.
        <>
          <img className="spotify-icon-on-dark" src={spotifyIconWhite} alt={`${name} logo`} />
          <img className="spotify-icon-on-light" src={spotifyIconBlack} alt="" aria-hidden="true" />
        </>
      ) : image ? (
        <img src={image} alt={`${name} logo`} />
      ) : brand ? (
        <svg viewBox="0 0 24 24" role="img" aria-label={`${name} logo`} fill={brand.hex === '000000' ? 'currentColor' : `#${brand.hex}`}>
          <path d={brand.path} />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          role="img"
          aria-label={`${name} logo`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={NOTE_PATH} />
        </svg>
      )}
    </span>
  )
}
