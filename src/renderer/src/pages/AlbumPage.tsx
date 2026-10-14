import type { Album, ProviderStatus } from '@shared/types'
import { describeLength, kindName, releaseYear } from '../album/describe'
import { localAlbumTracks } from '../album/localAlbums'
import { useAlbumTracks } from '../album/useAlbumTracks'
import type { Artist } from '../artist/useArtistSongs'
import { ArtistLinks } from '../components/ArtistLinks'
import { ChevronLeftIcon, ClockIcon, DiscIcon, PlayIcon, ShuffleIcon } from '../components/icons'
import { ProviderLogo } from '../components/ProviderLogo'
import { SpotifyFullLogo } from '../components/SpotifyFullLogo'
import { TrackRow } from '../components/TrackRow'
import { TrackSkeleton } from '../components/TrackSkeleton'
import type { Library } from '../library/useLibrary'
import type { Player } from '../player/usePlayer'

interface Props {
  album: Album
  /** The album's service. Only its tracks are shown and queued: services are never mixed. */
  provider: ProviderStatus
  library: Library
  player: Player
  backLabel: string
  onBack: () => void
  onOpenArtist: (artist: Artist) => void
}

/** One album: its cover and details, and all of its tracks in album order, ready to play. */
export function AlbumPage({ album, provider, library, player, backLabel, onBack, onOpenArtist }: Props): React.JSX.Element {
  const local = album.providerId === 'local'
  const fetched = useAlbumTracks(album, !local)
  const tracks = local ? localAlbumTracks(library.tracks, album) : fetched.tracks
  const ready = local || fetched.status === 'ready'
  const playable = tracks.filter((track) => track.playable !== false && track.madeForKids !== true)
  const year = releaseYear(album)
  const totalMs = tracks.reduce((sum, track) => sum + track.durationMs, 0)

  const playAll = (): void => {
    const first = playable[0]
    if (!first) return
    player.setShuffle(false)
    player.play(first, tracks)
  }
  const shuffleAll = (): void => {
    const pick = playable[Math.floor(Math.random() * playable.length)]
    if (!pick) return
    player.setShuffle(true)
    player.play(pick, tracks)
  }

  return (
    <main className="page page-wide album-page" data-service={album.providerId}>
      <button type="button" className="back-button" aria-label={`Back to ${backLabel}`} onClick={onBack}>
        <ChevronLeftIcon />
        {backLabel}
      </button>

      <header className="album-header">
        {album.artworkUrl ? (
          <img className="album-hero" src={album.artworkUrl} alt={`Cover of ${album.title}`} />
        ) : (
          <span className="album-hero album-cover-empty" aria-hidden="true">
            <DiscIcon />
          </span>
        )}
        <div className="album-heading">
          <span className="artist-service">
            <ProviderLogo id={provider.id} name={provider.name} size="sm" />
            {kindName(album)} on {provider.name}
          </span>
          <h1 title={album.title}>{album.title}</h1>
          <p className="album-byline">
            <ArtistLinks track={album} className="album-artists" onOpenArtist={onOpenArtist} />
            {year && <span>{year}</span>}
            {ready && tracks.length > 0 && <span>{describeLength(tracks.length, totalMs)}</span>}
          </p>
          <div className="album-actions">
            <button type="button" className="chip-action album-play" disabled={playable.length === 0} onClick={playAll}>
              <PlayIcon />
              Play
            </button>
            <button type="button" className="chip-action chip-secondary album-play" disabled={playable.length < 2} onClick={shuffleAll}>
              <ShuffleIcon />
              Shuffle
            </button>
            {/* Spotify's credit, with its logo, is at the foot of the page. */}
            {album.url && album.providerId !== 'spotify' && (
              <a className="album-link" href={album.url} target="_blank" rel="noreferrer">
                Open in {provider.name}
              </a>
            )}
          </div>
        </div>
      </header>

      <section className="artist-section" aria-label="Tracks">
        {!ready && fetched.status === 'loading' && <TrackSkeleton />}

        {fetched.status === 'error' && !local && (
          <div className="banner" role="alert">
            <span>
              {provider.name}: {fetched.error}
            </span>
            <button type="button" onClick={fetched.retry}>
              Retry
            </button>
          </div>
        )}

        {ready && tracks.length === 0 && <p className="empty">{provider.name} lists no tracks on this album that can be shown.</p>}

        {ready && tracks.length > 0 && (
          <>
            <div className="track-header" aria-hidden="true">
              <span />
              <span>Title</span>
              <span>Album</span>
              <span>Format</span>
              <span />
              <span className="column-duration">
                <ClockIcon />
              </span>
            </div>
            <ul className="tracks" aria-label={`Tracks on ${album.title}`}>
              {tracks.map((track) => {
                const current = player.track?.providerId === track.providerId && player.track.id === track.id
                return (
                  <TrackRow
                    key={track.id}
                    track={track}
                    provider={provider}
                    current={current}
                    playing={player.status === 'playing' || player.status === 'loading'}
                    onPlay={(picked) => (current ? player.toggle() : player.play(picked, tracks))}
                    onOpenArtist={onOpenArtist}
                  />
                )
              })}
            </ul>
          </>
        )}
      </section>

      {album.providerId === 'spotify' && (
        <p className="spotify-credit">
          <SpotifyFullLogo />
          <a href={album.url ?? 'https://open.spotify.com'} target="_blank" rel="noreferrer">
            Open Spotify
          </a>
        </p>
      )}
    </main>
  )
}
