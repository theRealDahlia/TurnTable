import { Fragment } from 'react'
import type { Track } from '@shared/types'

/** What credits artists: a track, or an album. */
export type Credited = Pick<Track, 'providerId' | 'artists' | 'artistIds'>
import type { Artist } from '../artist/useArtistSongs'

interface Props {
  track: Credited
  className: string
  /** When given, each name opens that artist's page on the track's own service. */
  onOpenArtist?: (artist: Artist) => void
}

/** The artist at `index` on a track, with the service's id for them when the track has one. */
export function artistOf(track: Credited, index: number): Artist {
  const id = track.artistIds?.[index]
  return { providerId: track.providerId, name: track.artists[index] ?? '', ...(id ? { id } : {}) }
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
            onClick={() => onOpenArtist(artistOf(track, index))}
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
