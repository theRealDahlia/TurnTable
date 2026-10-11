import { isPlayable, unplayableReason } from '@shared/media'
import type { ProviderStatus, Track } from '@shared/types'
import { formatQuality } from '../lib/quality'
import { formatDuration } from '../library/query'
import { NoteIcon, PauseIcon, PlayIcon } from './icons'
import { ProviderLogo } from './ProviderLogo'

interface Props {
  track: Track
  provider: ProviderStatus
  /** This row's track is the one loaded in the player. */
  current: boolean
  /** The player is actually producing sound (or about to). */
  playing: boolean
  onPlay: (track: Track) => void
}

export function TrackRow({ track, provider, current, playing, onPlay }: Props): React.JSX.Element {
  const playable = isPlayable(track)
  const action = current && playing ? 'Pause' : 'Play'
  const quality = formatQuality(track.quality)

  return (
    <li className="track" data-current={current} data-playing={current && playing} onDoubleClick={() => playable && onPlay(track)}>
      <div className="track-art-wrap">
        {track.artworkUrl ? (
          <img className="track-art" src={track.artworkUrl} alt="" loading="lazy" />
        ) : (
          <span className="track-art track-art-empty" aria-hidden="true">
            <NoteIcon />
          </span>
        )}
        <span className="equalizer" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <button
          type="button"
          className="track-play"
          aria-label={`${action} ${track.title}`}
          title={playable ? undefined : unplayableReason(track)}
          disabled={!playable}
          onClick={() => onPlay(track)}
        >
          {action === 'Pause' ? <PauseIcon /> : <PlayIcon />}
        </button>
      </div>
      <div className="track-main">
        <span className="track-title">{track.title}</span>
        <span className="track-artists">{track.artists.join(', ')}</span>
      </div>
      <span className="track-album">{track.album}</span>
      <span className="track-format">{quality}</span>
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
