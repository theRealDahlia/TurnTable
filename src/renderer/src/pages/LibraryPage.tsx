import { useMemo, useState } from 'react'
import type { ProviderId } from '@shared/types'
import { BrandMark, ClockIcon, SearchIcon } from '../components/icons'
import { QobuzNotice } from '../components/QobuzNotice'
import { RefreshMenu } from '../components/RefreshMenu'
import { SpotifyFullLogo } from '../components/SpotifyFullLogo'
import { TrackRow } from '../components/TrackRow'
import { TrackSkeleton } from '../components/TrackSkeleton'
import { filterTracks, sortTracks, type SortKey } from '../library/query'
import type { Library } from '../library/useLibrary'
import type { Player } from '../player/usePlayer'

/** Rows rendered at a time, so a library of thousands of tracks stays responsive. */
const PAGE_SIZE = 200

interface Props {
  library: Library
  player: Player
  onOpenConnections: () => void
}

export function LibraryPage({ library, player, onOpenConnections }: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  // Each service has its library to itself: Spotify's and SoundCloud's rules don't allow their content to be mixed with other services'.
  const [chosenId, setChosenId] = useState<ProviderId>()
  const [sort, setSort] = useState<SortKey>('recent')
  const [limit, setLimit] = useState(PAGE_SIZE)

  const connected = useMemo(() => library.providers.filter((provider) => provider.connected), [library.providers])
  const providersById = useMemo(() => new Map(library.providers.map((p) => [p.id, p])), [library.providers])
  // The chosen service, or the first connected one if none is chosen or the chosen one was disconnected.
  const providerId = connected.find((provider) => provider.id === chosenId)?.id ?? connected[0]?.id

  const visible = useMemo(
    () => sortTracks(filterTracks(library.tracks, { query, providerId }), sort),
    [library.tracks, query, providerId, sort]
  )

  const countFor = (id: ProviderId): number => library.libraries[id]?.tracks.length ?? 0
  const failed = connected.filter((provider) => library.libraries[provider.id]?.status === 'error')
  const filtering = query.trim() !== ''
  // While the first tracks are on their way, show placeholder rows instead of an empty page.
  const showSkeleton = library.loading && visible.length === 0 && !filtering

  const pickProvider = (id: ProviderId): void => {
    setChosenId(id)
    setLimit(PAGE_SIZE)
  }

  return (
    <main className="page page-wide" data-service={providerId}>
      <header className="page-header page-header-split">
        <div>
          <h1>Library</h1>
          <p>Your saved tracks, one service at a time.</p>
        </div>
        {connected.length > 0 && (
          <RefreshMenu
            providers={connected}
            busy={library.loading}
            refreshing={library.refreshing}
            onRefresh={(id) => (id ? library.refresh(id) : library.refresh())}
          />
        )}
      </header>

      {library.error && (
        <div className="banner" role="alert">
          <span>{library.error}</span>
          <button type="button" onClick={library.reload}>
            Retry
          </button>
        </div>
      )}

      {failed.map((provider) => (
        <div className="banner" role="alert" key={provider.id}>
          <span>
            {provider.name}: {library.libraries[provider.id]?.error}
          </span>
          <button type="button" aria-label={`Retry ${provider.name}`} onClick={() => library.retry(provider.id)}>
            Retry
          </button>
        </div>
      ))}

      {!library.listing && !library.error && connected.length === 0 && (
        <section className="empty-state">
          <BrandMark className="empty-icon" />
          <h2>No services connected</h2>
          <p>Connect a streaming service, or choose a folder of music files, to see your tracks here.</p>
          <button type="button" className="chip-action" onClick={onOpenConnections}>
            Go to Connections
          </button>
        </section>
      )}

      {connected.length > 0 && (
        <>
          <div className="library-controls">
            <div className="toolbar">
              <div className="search-field">
                <SearchIcon />
                <input
                  type="search"
                  className="search"
                  placeholder="Search title, artist, or album"
                  aria-label="Search your library"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setLimit(PAGE_SIZE)
                  }}
                />
              </div>
              <label className="sort">
                <span>Sort by</span>
                <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
                  <option value="recent">Recently saved</option>
                  <option value="title">Title</option>
                  <option value="artist">Artist</option>
                </select>
              </label>
            </div>

            <div className="filter-row">
              <div className="filters" role="group" aria-label="Filter by service">
                {connected.map((provider) => (
                  <button
                    type="button"
                    key={provider.id}
                    className="filter"
                    aria-pressed={provider.id === providerId}
                    onClick={() => pickProvider(provider.id)}
                  >
                    {provider.name} <span className="filter-count">{countFor(provider.id)}</span>
                  </button>
                ))}
              </div>

              <p className="summary" role="status">
                {library.refreshing
                  ? 'Refreshing your library…'
                  : library.loading
                    ? `Loading your library… ${providerId ? countFor(providerId) : 0} tracks so far`
                    : `${visible.length} ${visible.length === 1 ? 'track' : 'tracks'}${filtering ? ' found' : ''}`}
              </p>
            </div>

            {(visible.length > 0 || showSkeleton) && (
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
            )}
          </div>

          {visible.length === 0 && !library.loading && (
            <section className="empty-state compact">
              <SearchIcon className="empty-icon" />
              <p>{filtering ? 'No tracks match your search.' : 'No saved tracks found on your connected services.'}</p>
            </section>
          )}

          {showSkeleton && <TrackSkeleton />}

          <ul className="tracks" aria-label="Saved tracks">
            {visible.slice(0, limit).map((track) => {
              const provider = providersById.get(track.providerId)
              if (!provider) return null
              const current = player.track?.providerId === track.providerId && player.track.id === track.id
              return (
                <TrackRow
                  key={`${track.providerId}:${track.id}`}
                  track={track}
                  provider={provider}
                  current={current}
                  playing={player.status === 'playing' || player.status === 'loading'}
                  onPlay={(picked) => (current ? player.toggle() : player.play(picked, visible))}
                />
              )
            })}
          </ul>

          {visible.length > limit && (
            <button type="button" className="show-more" onClick={() => setLimit((current) => current + PAGE_SIZE)}>
              Show more ({visible.length - limit} remaining)
            </button>
          )}
        </>
      )}

      {providerId === 'spotify' && visible.length > 0 && (
        <p className="spotify-credit">
          <SpotifyFullLogo />
          <a href="https://open.spotify.com" target="_blank" rel="noreferrer">
            Open Spotify
          </a>
        </p>
      )}

      {library.listing && <TrackSkeleton />}

      {connected.some((provider) => provider.id === 'qobuz') && <QobuzNotice />}
    </main>
  )
}
