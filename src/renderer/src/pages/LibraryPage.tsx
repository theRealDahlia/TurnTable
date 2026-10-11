import { useMemo, useState } from 'react'
import type { ProviderId } from '@shared/types'
import { TrackRow } from '../components/TrackRow'
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
  const [providerId, setProviderId] = useState<ProviderId>()
  const [sort, setSort] = useState<SortKey>('recent')
  const [limit, setLimit] = useState(PAGE_SIZE)

  const connected = library.providers.filter((provider) => provider.connected)
  const providersById = useMemo(() => new Map(library.providers.map((p) => [p.id, p])), [library.providers])

  const visible = useMemo(
    () => sortTracks(filterTracks(library.tracks, { query, providerId }), sort),
    [library.tracks, query, providerId, sort]
  )

  const countFor = (id: ProviderId): number => library.libraries[id]?.tracks.length ?? 0
  const failed = connected.filter((provider) => library.libraries[provider.id]?.status === 'error')
  const filtering = query.trim() !== '' || providerId !== undefined

  const pickProvider = (id: ProviderId | undefined): void => {
    setProviderId(id)
    setLimit(PAGE_SIZE)
  }

  return (
    <main className="page page-wide">
      <header className="page-header">
        <h1>Library</h1>
        <p>Your saved tracks from every connected service.</p>
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
          <h2>No services connected</h2>
          <p>Connect a streaming service to see your saved tracks here.</p>
          <button type="button" className="chip-action" onClick={onOpenConnections}>
            Go to Connections
          </button>
        </section>
      )}

      {connected.length > 0 && (
        <>
          <div className="toolbar">
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
            <label className="sort">
              <span>Sort by</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
                <option value="recent">Recently saved</option>
                <option value="title">Title</option>
                <option value="artist">Artist</option>
              </select>
            </label>
          </div>

          <div className="filters" role="group" aria-label="Filter by service">
            <button
              type="button"
              className="filter"
              aria-pressed={providerId === undefined}
              onClick={() => pickProvider(undefined)}
            >
              All <span className="filter-count">{library.tracks.length}</span>
            </button>
            {connected.map((provider) => (
              <button
                type="button"
                key={provider.id}
                className="filter"
                aria-pressed={providerId === provider.id}
                onClick={() => pickProvider(provider.id)}
              >
                {provider.name} <span className="filter-count">{countFor(provider.id)}</span>
              </button>
            ))}
          </div>

          <p className="summary" role="status">
            {library.loading
              ? `Loading your library… ${library.tracks.length} tracks so far`
              : `${visible.length} ${visible.length === 1 ? 'track' : 'tracks'}${filtering ? ' found' : ''}`}
          </p>

          {visible.length === 0 && !library.loading && (
            <p className="empty">
              {filtering ? 'No tracks match your search.' : 'No saved tracks found on your connected services.'}
            </p>
          )}

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
    </main>
  )
}
