// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Album } from '@shared/types'
import { AlbumShelf } from './AlbumShelf'

const album = (id: string, overrides: Partial<Album> = {}): Album => ({ id, providerId: 'tidal', title: `Album ${id}`, artists: ['Foo Fighters'], ...overrides })

afterEach(cleanup)

const shelf = (props: Partial<React.ComponentProps<typeof AlbumShelf>> = {}) => {
  const handlers = { onLoadMore: vi.fn(), onOpen: vi.fn() }
  render(<AlbumShelf albums={[]} loading={false} hasMore={false} loadingMore={false} label="Albums by Foo Fighters" {...handlers} {...props} />)
  return handlers
}

describe('AlbumShelf', () => {
  it('shows each album with its cover, title, year and kind, and opens the one clicked', async () => {
    const albums = [album('1', { artworkUrl: 'https://img/1.jpg', releaseDate: '1997-05-20', kind: 'album' }), album('2', { kind: 'single' })]
    const { onOpen } = shelf({ albums })

    const row = within(screen.getByRole('list', { name: 'Albums by Foo Fighters' }))
    expect(row.getAllByRole('listitem')).toHaveLength(2)
    expect(row.getByText('1997 · Album')).toBeTruthy()
    expect(row.getByText('Single')).toBeTruthy()
    expect(document.querySelector('img.album-cover')?.getAttribute('src')).toBe('https://img/1.jpg')

    await userEvent.click(row.getByRole('button', { name: /Album 2/ }))
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(albums[1])
  })

  it('shows placeholders while loading', () => {
    shelf({ loading: true })
    expect(screen.getByRole('list', { name: 'Albums by Foo Fighters' }).getAttribute('aria-busy')).toBe('true')
    expect(document.querySelectorAll('.album-card .skeleton-block').length).toBeGreaterThan(0)
  })

  it('scrolls sideways with the arrow buttons', async () => {
    shelf({ albums: [album('1')] })
    const row = screen.getByRole('list', { name: 'Albums by Foo Fighters' })
    const scrollBy = vi.fn()
    Object.assign(row, { scrollBy })
    // jsdom lays nothing out, so give the row a width to scroll by.
    Object.defineProperty(row, 'clientWidth', { value: 600 })

    await userEvent.click(screen.getByRole('button', { name: 'Scroll Albums by Foo Fighters forward' }))
    await userEvent.click(screen.getByRole('button', { name: 'Scroll Albums by Foo Fighters back' }))

    expect(scrollBy.mock.calls.map(([options]) => Math.sign((options as ScrollToOptions).left ?? 0))).toEqual([1, -1])
  })

  it('offers a button for more where the end of the row cannot be watched', async () => {
    const { onLoadMore } = shelf({ albums: [album('1')], hasMore: true })
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(onLoadMore).toHaveBeenCalledOnce()
  })

  it('fetches more by itself as the end of the row comes into view', () => {
    let report: (entries: { isIntersecting: boolean }[]) => void = () => undefined
    const observe = vi.fn()
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: typeof report) {
          report = callback
        }
        observe = observe
        disconnect = vi.fn()
      }
    )
    const { onLoadMore } = shelf({ albums: [album('1')], hasMore: true })
    expect(observe).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull()

    report([{ isIntersecting: true }])
    expect(onLoadMore).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })
})
