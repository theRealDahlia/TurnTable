import { formatQuality } from '../lib/quality'
import { NextIcon, NoteIcon, PauseIcon, PlayIcon, PreviousIcon, ShuffleIcon, SpeakerIcon } from './icons'
import { formatDuration } from '../library/query'
import type { Player } from '../player/usePlayer'
import { SpotifyFullLogo } from './SpotifyFullLogo'

interface Props {
  player: Player
}

/** How full a slider is, as a CSS length, so the track can be drawn filled up to the thumb. */
const fill = (fraction: number): React.CSSProperties =>
  ({ '--progress': `${Math.round(Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0)) * 10000) / 100}%` }) as React.CSSProperties

export function PlayerBar({ player }: Props): React.JSX.Element | null {
  const { track, status } = player
  if (!track) return null

  const quality = formatQuality(track.quality)
  // Show "pause" while loading too, since playback is about to start.
  const active = status === 'playing' || status === 'loading'
  const elapsed = formatDuration(player.currentTime * 1000)
  const total = formatDuration(player.duration * 1000)

  return (
    <footer className="player" aria-label="Player" data-status={status}>
      <div className="player-track">
        {track.artworkUrl ? <img className="track-art" src={track.artworkUrl} alt="" /> : <span className="track-art track-art-empty" aria-hidden="true">
            <NoteIcon />
          </span>}
        <div className="player-meta">
          <span className="track-title">{track.title}</span>
          <span className="track-artists">{track.artists.join(', ')}</span>
          {quality && (
            <span className="quality-badge" title={quality}>
              {quality}
            </span>
          )}
        </div>
        {/* Spotify asks for its logo wherever its content plays, and a link back to it. */}
        {track.providerId === 'spotify' && (
          <span className="spotify-credit spotify-credit-player">
            <SpotifyFullLogo size="sm" />
            {track.url && (
              <a href={track.url} target="_blank" rel="noreferrer">
                Open Spotify
              </a>
            )}
          </span>
        )}
      </div>

      <div className="player-center">
        <div className="transport">
          <button
            type="button"
            className="shuffle"
            aria-label="Shuffle"
            aria-pressed={player.shuffle}
            title={player.shuffle ? 'Shuffle is on' : 'Shuffle is off'}
            onClick={() => player.setShuffle(!player.shuffle)}
          >
            <ShuffleIcon />
          </button>
          <button type="button" aria-label="Previous track" onClick={player.previous}>
            <PreviousIcon />
          </button>
          <button type="button" className="play-main" aria-label={active ? 'Pause' : 'Play'} onClick={player.toggle}>
            {active ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button type="button" aria-label="Next track" disabled={!player.hasNext} onClick={player.next}>
            <NextIcon />
          </button>
        </div>
        <div className="seek">
          <time>{elapsed}</time>
          <input
            type="range"
            aria-label="Seek"
            aria-valuetext={`${elapsed} of ${total}`}
            min={0}
            max={player.duration || 0}
            step={0.1}
            value={Math.min(player.currentTime, player.duration || 0)}
            style={fill(player.duration > 0 ? player.currentTime / player.duration : 0)}
            onChange={(event) => player.seek(Number(event.target.value))}
          />
          <time>{total}</time>
        </div>
      </div>

      <div className="player-volume">
        <SpeakerIcon />
        <input
          type="range"
          aria-label="Volume"
          min={0}
          max={1}
          step={0.01}
          value={player.volume}
          style={fill(player.volume)}
          onChange={(event) => player.setVolume(Number(event.target.value))}
        />
      </div>

      {player.error && (
        <p className="player-error" role="alert">
          {player.error}
        </p>
      )}
    </footer>
  )
}
