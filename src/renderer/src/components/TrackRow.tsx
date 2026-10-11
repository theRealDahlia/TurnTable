import type { ProviderStatus, Track } from '@shared/types'
import { formatDuration } from '../library/query'
import { ProviderLogo } from './ProviderLogo'

interface Props {
  track: Track
  provider: ProviderStatus
}

export function TrackRow({ track, provider }: Props): React.JSX.Element {
  return (
    <li className="track">
      {track.artworkUrl ? (
        <img className="track-art" src={track.artworkUrl} alt="" loading="lazy" />
      ) : (
        <span className="track-art track-art-empty" aria-hidden="true" />
      )}
      <div className="track-main">
        <span className="track-title">{track.title}</span>
        <span className="track-artists">{track.artists.join(', ')}</span>
      </div>
      <span className="track-album">{track.album}</span>
      {track.url ? (
        <a
          className="track-source"
          href={track.url}
          target="_blank"
          rel="noreferrer"
          title={`Open on ${provider.name}`}
          aria-label={`Open ${track.title} on ${provider.name}`}
        >
          <ProviderLogo id={provider.id} name={provider.name} size="sm" />
        </a>
      ) : (
        <span className="track-source" title={`Saved on ${provider.name}`}>
          <ProviderLogo id={provider.id} name={provider.name} size="sm" />
        </span>
      )}
      <span className="track-duration">{formatDuration(track.durationMs)}</span>
    </li>
  )
}
