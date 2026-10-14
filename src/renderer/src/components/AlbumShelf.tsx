import { useEffect, useRef } from 'react'
import type { Album } from '@shared/types'
import { kindName, releaseYear } from '../album/describe'
import { ChevronLeftIcon, ChevronRightIcon, DiscIcon } from './icons'

interface Props {
  albums: Album[]
  /** Placeholder cards while the first albums are on their way. */
  loading: boolean
  /** More albums can be fetched; they are, once the end of the row scrolls into view. */
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  onOpen: (album: Album) => void
  label: string
}

/** How far the arrow buttons scroll the row: most of what is showing, so one card stays in view for context. */
const STEP = 0.85

/** A row of album covers that scrolls sideways. Covers are shown exactly as the service gives them, with nothing over them. */
export function AlbumShelf({ albums, loading, hasMore, loadingMore, onLoadMore, onOpen, label }: Props): React.JSX.Element {
  const row = useRef<HTMLUListElement>(null)
  const end = useRef<HTMLLIElement>(null)

  // Fetch the next page as the end of the row nears the screen, the same way search results load.
  const watching = hasMore && !loadingMore && typeof IntersectionObserver !== 'undefined'
  useEffect(() => {
    const target = end.current
    if (!watching || !target) return
    const observer = new IntersectionObserver((entries) => entries.some((entry) => entry.isIntersecting) && onLoadMore(), {
      root: row.current,
      rootMargin: '0px 400px 0px 0px'
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [watching, onLoadMore, albums.length])

  const scroll = (direction: 1 | -1): void => {
    const list = row.current
    if (list) list.scrollBy({ left: direction * list.clientWidth * STEP, behavior: 'smooth' })
  }

  return (
    <div className="album-shelf">
      <div className="album-shelf-buttons">
        <button type="button" className="shelf-arrow" aria-label={`Scroll ${label} back`} onClick={() => scroll(-1)}>
          <ChevronLeftIcon />
        </button>
        <button type="button" className="shelf-arrow" aria-label={`Scroll ${label} forward`} onClick={() => scroll(1)}>
          <ChevronRightIcon />
        </button>
      </div>
      <ul className="album-row" aria-label={label} aria-busy={loading || loadingMore} ref={row}>
        {albums.map((album) => {
          const year = releaseYear(album)
          return (
            <li key={album.id} className="album-card">
              <button type="button" className="album-open" onClick={() => onOpen(album)} title={album.title}>
                {album.artworkUrl ? (
                  <img className="album-cover" src={album.artworkUrl} alt="" loading="lazy" />
                ) : (
                  <span className="album-cover album-cover-empty" aria-hidden="true">
                    <DiscIcon />
                  </span>
                )}
                <span className="album-title">{album.title}</span>
                <span className="album-meta">{[year, kindName(album)].filter(Boolean).join(' · ')}</span>
              </button>
            </li>
          )
        })}
        {loading &&
          Array.from({ length: 6 }, (_, index) => (
            <li key={`placeholder-${index}`} className="album-card" aria-hidden="true">
              <span className="album-cover skeleton-block" />
              <span className="skeleton-block album-skeleton-line" />
            </li>
          ))}
        {(hasMore || loadingMore) && (
          <li ref={end} className="album-card album-more">
            {watching ? (
              <span className="album-more-hint" aria-hidden="true" />
            ) : (
              <button type="button" className="show-more" disabled={loadingMore} onClick={onLoadMore}>
                {loadingMore ? 'Loading…' : 'More'}
              </button>
            )}
          </li>
        )}
      </ul>
    </div>
  )
}
