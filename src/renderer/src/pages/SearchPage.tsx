import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProviderId, ProviderStatus, Track } from '@shared/types'
import { BrandMark, ClockIcon, SearchIcon } from '../components/icons'
import { ProviderLogo } from '../components/ProviderLogo'
import { SpotifyFullLogo } from '../components/SpotifyFullLogo'
import { TrackRow } from '../components/TrackRow'
import { TrackSkeleton } from '../components/TrackSkeleton'
import { filterTracks, sortResults, type ResultSortKey } from '../library/query'
import type { Library } from '../library/useLibrary'
import type { Artist } from '../artist/useArtistSongs'
import type { Player } from '../player/usePlayer'
import { trackKey, type ProviderResults, type SearchState } from '../search/useSearch'

interface Props {
  library: Library
  player: Player
  search: SearchState
  onOpenConnections: () => void
  /** When given, each artist's name opens their page. */
  onOpenArtist?: (artist: Artist) => void
}

/** How far before the end of the list the next page is fetched, so it is usually there before the user arrives. */
const PREFETCH_DISTANCE = '400px'

/** Local files are searched in the library the app already has, so there is nothing to wait for. */
const LOCAL: ProviderId = 'local'

export function SearchPage({ library, player, search, onOpenConnections, onOpenArtist }: Props): React.JSX.Element {
  const [draft, setDraft] = useState(search.query)
  // One order for every tab. "Best match" is the order each service returned.
  const [sort, setSort] = useState<ResultSortKey>('relevance')
  const tabList = useRef<HTMLDivElement>(null)

  const connected = library.providers.filter((provider) => provider.connected)
  const remote = connected.filter((provider) => provider.searchable)
  const local = connected.find((provider) => provider.id === LOCAL)
  const tabs: ProviderStatus[] = [...remote, ...(local ? [local] : [])]
  const providersById = useMemo(() => new Map(library.providers.map((p) => [p.id, p])), [library.providers])

  const active = tabs.find((tab) => tab.id === search.tab) ?? tabs[0]
  const localMatches = useMemo(
    () => (search.query ? filterTracks(library.tracks.filter((t) => t.providerId === LOCAL), { query: search.query }) : []),
    [library.tracks, search.query]
  )
  const resultsFor = (id: ProviderId): ProviderResults | undefined =>
    id === LOCAL ? { status: library.loading ? 'loading' : 'ready', tracks: localMatches, loadingMore: false } : search.results[id]

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    search.search(draft, remote.map((p) => p.id), tabs.map((p) => p.id))
  }

  const moveTab = (event: React.KeyboardEvent, index: number): void => {
    const keys: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }
    const next = keys[event.key]
    if (next === undefined) return
    event.preventDefault()
    const target = tabs[(next + tabs.length) % tabs.length]
    if (!target) return
    search.selectTab(target.id)
    tabList.current?.querySelector<HTMLElement>(`[data-tab="${target.id}"]`)?.focus()
  }

  const results = active ? resultsFor(active.id) : undefined
  const sorted = results ? sortResults(results.tracks, sort) : []

  // More results load by themselves as the end of the list nears the screen, unless that has been paused
  // (repeated empty pages, or a failure), in which case a button takes over.
  const canWatch = typeof IntersectionObserver !== 'undefined'
  const autoLoad = canWatch && results?.nextCursor !== undefined && !results.paused
  const sentinel = useRef<HTMLDivElement>(null)
  const activeId = active?.id
  const { loadMore } = search
  const tracksShown = results?.tracks.length
  const cursor = results?.nextCursor
  useEffect(() => {
    const end = sentinel.current
    if (!autoLoad || !end || !activeId) return
    // A fresh observer reports the end's position at once, so a list too short to scroll keeps filling up.
    const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && loadMore(activeId), { rootMargin: PREFETCH_DISTANCE })
    observer.observe(end)
    return () => observer.disconnect()
  }, [autoLoad, activeId, loadMore, tracksShown, cursor])
  const rowsFor = (tracks: Track[], provider: ProviderStatus): React.JSX.Element => (
    <ul className="tracks" aria-label={`${provider.name} results`}>
      {tracks.map((track) => {
        const current = player.track?.providerId === track.providerId && player.track.id === track.id
        return (
          <TrackRow
            key={trackKey(track)}
            track={track}
            provider={provider}
            current={current}
            playing={player.status === 'playing' || player.status === 'loading'}
            onPlay={(picked) => (current ? player.toggle() : player.play(picked, tracks))}
            onToggleSave={provider.savable ? search.toggleSave : undefined}
            savePending={search.pending[trackKey(track)] === true}
            onOpenArtist={onOpenArtist}
          />
        )
      })}
    </ul>
  )

  return (
    <main className="page page-wide">
      <header className="page-header">
        <h1>Search</h1>
        <p>Find songs on your connected services, and save them to your library.</p>
      </header>

      <form className="search-form" role="search" onSubmit={submit}>
        <div className="search-field">
          <SearchIcon />
          <input
            type="search"
            className="search"
            placeholder="Search songs, artists, or albums"
            aria-label="Search for songs"
            value={draft}
            autoFocus
            onChange={(event) => setDraft(event.target.value)}
          />
        </div>
        <button type="submit" className="search-submit" disabled={!draft.trim() || tabs.length === 0}>
          Search
        </button>
      </form>

      {tabs.length === 0 && (
        <section className="empty-state">
          <BrandMark className="empty-icon" />
          <h2>No services connected</h2>
          <p>Connect a streaming service to search it from here.</p>
          <button type="button" className="chip-action" onClick={onOpenConnections}>
            Go to Connections
          </button>
        </section>
      )}

      {tabs.length > 0 && !search.query && (
        <section className="empty-state compact">
          <SearchIcon className="empty-icon" />
          <p>Search for a song, artist or album. Results appear under a tab for each of your services.</p>
        </section>
      )}

      {tabs.length > 0 && search.query && active && (
        <>
          <div className="search-controls">
            <div className="search-tabs" role="tablist" aria-label="Search results by service" ref={tabList}>
              {tabs.map((tab, index) => {
                const own = resultsFor(tab.id)
                const selected = tab.id === active.id
                return (
                  <button
                    type="button"
                    role="tab"
                    key={tab.id}
                    id={`search-tab-${tab.id}`}
                    data-tab={tab.id}
                    className="filter"
                    aria-selected={selected}
                    aria-controls="search-panel"
                    tabIndex={selected ? 0 : -1}
                    onClick={() => search.selectTab(tab.id)}
                    onKeyDown={(event) => moveTab(event, index)}
                  >
                    <ProviderLogo id={tab.id} name={tab.name} size="sm" />
                    {tab.name}
                    {own?.status === 'ready' && <span className="filter-count">{own.tracks.length}</span>}
                  </button>
                )
              })}
            </div>
            <label className="sort">
              <span>Sort by</span>
              <select value={sort} onChange={(event) => setSort(event.target.value as ResultSortKey)}>
                <option value="relevance">Best match</option>
                <option value="title">Title</option>
                <option value="artist">Artist</option>
                <option value="album">Album</option>
                <option value="shortest">Shortest first</option>
                <option value="longest">Longest first</option>
              </select>
            </label>
          </div>

          <div id="search-panel" role="tabpanel" aria-labelledby={`search-tab-${active.id}`} className="search-results" data-service={active.id}>
            {active.needsReauthorization && active.savable && (
              <div className="banner" role="status">
                <span>Reconnect {active.name} to save songs from here.</span>
                <button type="button" onClick={onOpenConnections}>
                  Connections
                </button>
              </div>
            )}

            {search.saveError?.providerId === active.id && (
              <div className="banner" role="alert">
                <span>{search.saveError.message}</span>
              </div>
            )}

            {results?.status === 'error' && (
              <div className="banner" role="alert">
                <span>
                  {active.name}: {results.error}
                </span>
                <button type="button" aria-label={`Retry ${active.name}`} onClick={() => search.retry(active.id)}>
                  Retry
                </button>
              </div>
            )}

            {results?.status === 'loading' && <TrackSkeleton withSave={active.savable === true} />}

            {results?.status === 'ready' && results.tracks.length === 0 && autoLoad && (
              <p className="search-loading" role="status">
                Looking for more…
              </p>
            )}

            {results?.status === 'ready' && results.tracks.length === 0 && !autoLoad && (
              <section className="empty-state compact">
                <SearchIcon className="empty-icon" />
                <p>
                  No {active.name} results for “{search.query}”.
                </p>
              </section>
            )}

            {results?.status === 'ready' && results.tracks.length > 0 && (
              <>
                <div className="track-header" aria-hidden="true">
                  <span />
                  <span>Title</span>
                  <span>Album</span>
                  <span>Format</span>
                  <span />
                  {active.savable && <span />}
                  <span className="column-duration">
                    <ClockIcon />
                  </span>
                </div>
                {rowsFor(sorted, providersById.get(active.id) ?? active)}
              </>
            )}

            {autoLoad && <div ref={sentinel} className="search-sentinel" aria-hidden="true" />}

            {results?.loadingMore && (
              <p className="search-loading" role="status">
                Loading more…
              </p>
            )}

            {active.id === 'spotify' && results?.status === 'ready' && results.tracks.length > 0 && (
              <p className="spotify-credit">
                <SpotifyFullLogo />
                <a href="https://open.spotify.com" target="_blank" rel="noreferrer">
                  Open Spotify
                </a>
              </p>
            )}

            {results?.nextCursor && !autoLoad && (
              <button type="button" className="show-more" disabled={results.loadingMore} onClick={() => search.loadMore(active.id)}>
                {results.loadingMore ? 'Loading…' : 'Show more'}
              </button>
            )}
          </div>
        </>
      )}
    </main>
  )
}
