import { formatQuality } from '../lib/quality'
import { formatDuration } from '../library/query'
import type { Player } from '../player/usePlayer'

const ICON = {
  viewBox: '0 0 24 24',
  fill: 'currentColor',
  'aria-hidden': true
} as const

const PlayIcon = (): React.JSX.Element => (
  <svg {...ICON}>
    <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
  </svg>
)
const PauseIcon = (): React.JSX.Element => (
  <svg {...ICON}>
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
)
const PreviousIcon = (): React.JSX.Element => (
  <svg {...ICON}>
    <path d="M6 5h2v14H6zM20 5.6v12.8a.8.8 0 0 1-1.25.66L9.5 12.66a.8.8 0 0 1 0-1.32l9.25-6.4A.8.8 0 0 1 20 5.6Z" />
  </svg>
)
const NextIcon = (): React.JSX.Element => (
  <svg {...ICON}>
    <path d="M16 5h2v14h-2zM4 5.6v12.8a.8.8 0 0 0 1.25.66l9.25-6.4a.8.8 0 0 0 0-1.32L5.25 4.94A.8.8 0 0 0 4 5.6Z" />
  </svg>
)

interface Props {
  player: Player
}

export function PlayerBar({ player }: Props): React.JSX.Element | null {
  const { track, status } = player
  if (!track) return null

  const quality = formatQuality(track.quality)
  // Show "pause" while loading too, since playback is about to start.
  const active = status === 'playing' || status === 'loading'
  const elapsed = formatDuration(player.currentTime * 1000)
  const total = formatDuration(player.duration * 1000)

  return (
    <footer className="player" aria-label="Player">
      <div className="player-track">
        {track.artworkUrl ? <img className="track-art" src={track.artworkUrl} alt="" /> : <span className="track-art track-art-empty" aria-hidden="true" />}
        <div className="player-meta">
          <span className="track-title">{track.title}</span>
          <span className="track-artists">{track.artists.join(', ')}</span>
          {quality && <span className="quality-badge">{quality}</span>}
        </div>
      </div>

      <div className="player-center">
        <div className="transport">
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
            onChange={(event) => player.seek(Number(event.target.value))}
          />
          <time>{total}</time>
        </div>
      </div>

      <div className="player-volume">
        <input
          type="range"
          aria-label="Volume"
          min={0}
          max={1}
          step={0.01}
          value={player.volume}
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
