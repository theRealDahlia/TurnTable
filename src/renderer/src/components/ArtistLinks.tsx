import { Fragment } from 'react'
import type { Track } from '@shared/types'
import type { Artist } from '../artist/useArtistSongs'

interface Props {
  track: Track
  className: string
  /** When given, each name opens that artist's page on the track's own service. */
  onOpenArtist?: (artist: Artist) => void
}

/** A track's artists, comma-separated. The whole list is in the hover text, in case it is cut short to fit. */
export function ArtistLinks({ track, className, onOpenArtist }: Props): React.JSX.Element {
  const all = track.artists.join(', ')
  if (!onOpenArtist) {
    return (
      <span className={className} title={all}>
        {all}
      </span>
    )
  }
  return (
    <span className={className} title={all}>
      {track.artists.map((name, index) => (
        <Fragment key={`${index}:${name}`}>
          {index > 0 && ', '}
          <button
            type="button"
            className="artist-link"
            onClick={() => onOpenArtist({ providerId: track.providerId, name })}
            // A double-click on a row plays it; on a name it only opens the artist.
            onDoubleClick={(event) => event.stopPropagation()}
          >
            {name}
          </button>
        </Fragment>
      ))}
    </span>
  )
}
