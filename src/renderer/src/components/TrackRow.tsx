import { isPlayable, unplayableReason } from '@shared/media'
import type { ProviderStatus, Track } from '@shared/types'
import type { Artist } from '../artist/useArtistSongs'
import { formatQuality } from '../lib/quality'
import { formatDuration } from '../library/query'
import { HeartIcon, NoteIcon, PauseIcon, PlayIcon } from './icons'
import { ArtistLinks } from './ArtistLinks'
import { ProviderLogo } from './ProviderLogo'

interface Props {
  track: Track
  provider: ProviderStatus
  /** This row's track is the one loaded in the player. */
  current: boolean
  /** The player is actually producing sound (or about to). */
  playing: boolean
  onPlay: (track: Track) => void
  /** When given, the row gets a button that saves the track to the user's library, or removes it again. */
  onToggleSave?: (track: Track) => void
  /** A save or removal is still being sent. */
  savePending?: boolean
  /** When given, each artist's name opens their page. */
  onOpenArtist?: (artist: Artist) => void
}

export function TrackRow({ track, provider, current, playing, onPlay, onToggleSave, savePending = false, onOpenArtist }: Props): React.JSX.Element {
  const playable = isPlayable(track)
  const action = current && playing ? 'Pause' : 'Play'
  const quality = formatQuality(track.quality)

  return (
    <li className="track" data-provider={provider.id} data-current={current} data-playing={current && playing} onDoubleClick={() => playable && onPlay(track)}>
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
        {/* Titles are shown as the service gives them; when one is cut short to fit, the hover text has all of it. */}
        <span className="track-title" title={track.title}>
          {track.title}
        </span>
        <ArtistLinks track={track} className="track-artists" onOpenArtist={onOpenArtist} />
      </div>
      <span className="track-album" title={track.album}>
        {track.album}
      </span>
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
      {onToggleSave && (
        <button
          type="button"
          className="track-save"
          aria-label={`Save ${track.title}`}
          aria-pressed={track.saved === true}
          aria-busy={savePending}
          disabled={savePending}
          title={track.saved ? `Saved on ${provider.name}. Click to remove.` : `Save to ${provider.name}`}
          onClick={() => onToggleSave(track)}
        >
          <HeartIcon filled={track.saved === true} />
        </button>
      )}
      <span className="track-duration">{formatDuration(track.durationMs)}</span>
    </li>
  )
}
