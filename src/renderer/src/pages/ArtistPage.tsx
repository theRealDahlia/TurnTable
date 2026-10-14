import { useMemo } from 'react'
import type { Album, ProviderStatus, Track } from '@shared/types'
import { localAlbums } from '../album/localAlbums'
import { useArtistAlbums } from '../album/useArtistAlbums'
import { AlbumShelf } from '../components/AlbumShelf'
import { useArtistSongs, type Artist } from '../artist/useArtistSongs'
import { ChevronLeftIcon, ClockIcon, SearchIcon } from '../components/icons'
import { ProviderLogo } from '../components/ProviderLogo'
import { SpotifyFullLogo } from '../components/SpotifyFullLogo'
import { TrackRow } from '../components/TrackRow'
import { TrackSkeleton } from '../components/TrackSkeleton'
import { sameName, tracksByArtist } from '../library/query'
import type { Library } from '../library/useLibrary'
import type { Player } from '../player/usePlayer'

interface Props {
  artist: Artist
  /** The service the artist belongs to. Only its songs are shown: services are never mixed. */
  provider: ProviderStatus
  library: Library
  player: Player
  /** Where "Back" goes: the page the artist was opened from. */
  backLabel: string
  onBack: () => void
  onOpenArtist: (artist: Artist) => void
  onOpenAlbum: (album: Album) => void
}

/** The service's id for the artist: the one they were opened with, else one a song of theirs carries. */
function findArtistId(artist: Artist, tracks: Track[]): string | undefined {
  if (artist.id) return artist.id
  for (const track of tracks) {
    const index = track.artists.findIndex((name) => sameName(name, artist.name))
    const id = index >= 0 ? track.artistIds?.[index] : undefined
    if (id) return id
  }
  return undefined
}

/** One artist on one service: their songs in your library there, and more of their songs the service finds. */
export function ArtistPage({ artist, provider, library, player, backLabel, onBack, onOpenArtist, onOpenAlbum }: Props): React.JSX.Element {
  // Local files have nothing to search but the library itself.
  const searchable = provider.searchable === true && provider.id !== 'local'
  const songs = useArtistSongs(artist, searchable)

  const saved = useMemo(() => tracksByArtist(library.tracks, artist.name, artist.providerId), [library.tracks, artist])
  const savedIds = useMemo(() => new Set(saved.map((track) => track.id)), [saved])
  // What the service found, less the songs already listed as saved.
  const more = songs.tracks.filter((track) => !savedIds.has(track.id))
  const libraryLoaded = library.libraries[artist.providerId]?.status === 'ready' || artist.providerId === 'local'

  // Albums: local files are grouped by their tags; other services list the artist's albums, which needs their id there.
  const local = artist.providerId === 'local'
  const artistId = local ? undefined : findArtistId(artist, [...saved, ...songs.tracks])
  const remoteAlbums = useArtistAlbums(artist.providerId, artistId, provider.albums === true && !local)
  const ownAlbums = useMemo(() => (local ? localAlbums(library.tracks, artist.name) : []), [local, library.tracks, artist.name])
  const albums = local ? ownAlbums : remoteAlbums.albums
  const albumsLoading = remoteAlbums.status === 'loading'

  const rows = (tracks: Track[], label: string): React.JSX.Element => (
    <ul className="tracks" aria-label={label}>
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
  )

  const header = (
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
  )

  const nothing = saved.length === 0 && (songs.status === 'idle' || (songs.status === 'ready' && more.length === 0 && !songs.hasMore))
  const shown = saved.length + more.length

  return (
    <main className="page page-wide artist-page" data-service={artist.providerId}>
      <button type="button" className="back-button" aria-label={`Back to ${backLabel}`} onClick={onBack}>
        <ChevronLeftIcon />
        {backLabel}
      </button>

      <header className="page-header artist-header">
        <span className="artist-service">
          <ProviderLogo id={provider.id} name={provider.name} size="sm" />
          Artist on {provider.name}
        </span>
        <h1>{artist.name}</h1>
        {shown > 0 && (
          <p role="status">
            {shown} {shown === 1 ? 'song' : 'songs'}
            {saved.length > 0 && ` · ${saved.length} in your library`}
          </p>
        )}
      </header>

      {(albums.length > 0 || albumsLoading || remoteAlbums.status === 'error') && (
        <section className="artist-section" aria-labelledby="artist-albums">
          <h2 id="artist-albums">Albums</h2>
          {remoteAlbums.status === 'error' ? (
            <div className="banner" role="alert">
              <span>
                {provider.name}: {remoteAlbums.error}
              </span>
              <button type="button" onClick={remoteAlbums.retry}>
                Retry
              </button>
            </div>
          ) : (
            <AlbumShelf
              albums={albums}
              loading={albumsLoading && albums.length === 0}
              hasMore={remoteAlbums.hasMore}
              loadingMore={remoteAlbums.loadingMore}
              onLoadMore={remoteAlbums.loadMore}
              onOpen={onOpenAlbum}
              label={`Albums by ${artist.name}`}
            />
          )}
          {remoteAlbums.moreError && (
            <div className="banner" role="alert">
              <span>
                {provider.name}: {remoteAlbums.moreError}
              </span>
            </div>
          )}
        </section>
      )}

      {saved.length > 0 && (
        <section className="artist-section" aria-labelledby="artist-saved">
          <h2 id="artist-saved">In your library</h2>
          {header}
          {rows(saved, `${artist.name} in your library`)}
        </section>
      )}

      {searchable && (
        <section className="artist-section" aria-labelledby="artist-more">
          <h2 id="artist-more">{saved.length > 0 ? `More on ${provider.name}` : `On ${provider.name}`}</h2>

          {songs.status === 'loading' && <TrackSkeleton />}

          {songs.status === 'error' && (
            <div className="banner" role="alert">
              <span>
                {provider.name}: {songs.error}
              </span>
              <button type="button" onClick={songs.retry}>
                Retry
              </button>
            </div>
          )}

          {songs.status === 'ready' && more.length > 0 && (
            <>
              {header}
              {rows(more, `More by ${artist.name} on ${provider.name}`)}
            </>
          )}

          {songs.status === 'ready' && more.length === 0 && !nothing && (
            <p className="empty">{songs.hasMore ? `None yet. ${provider.name} may have more further on.` : `No other songs by ${artist.name} on ${provider.name}.`}</p>
          )}

          {songs.moreError && (
            <div className="banner" role="alert">
              <span>
                {provider.name}: {songs.moreError}
              </span>
            </div>
          )}

          {songs.hasMore && (
            <button type="button" className="show-more" disabled={songs.loadingMore} onClick={songs.loadMore}>
              {songs.loadingMore ? 'Looking…' : 'Find more'}
            </button>
          )}
        </section>
      )}

      {nothing && (
        <section className="empty-state compact">
          <SearchIcon className="empty-icon" />
          <p>
            {libraryLoaded || searchable
              ? `No songs by ${artist.name} on ${provider.name}.`
              : `Open ${provider.name} in your Library to see your songs by ${artist.name}.`}
          </p>
        </section>
      )}

      {artist.providerId === 'spotify' && shown > 0 && (
        <p className="spotify-credit">
          <SpotifyFullLogo />
          <a href="https://open.spotify.com" target="_blank" rel="noreferrer">
            Open Spotify
          </a>
        </p>
      )}
    </main>
  )
}
