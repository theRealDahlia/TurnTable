// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'

afterEach(cleanup)

describe('Sidebar', () => {
  it('shows the app\'s name at the top', () => {
    const { container } = render(<Sidebar page="library" onNavigate={vi.fn()} />)
    expect(container.querySelector('.brand')?.textContent).toBe('Muze')
  })

  it('lists Library, Search and Connections in that order, marking the current page', () => {
    render(<Sidebar page="search" onNavigate={vi.fn()} />)
    const nav = within(screen.getByRole('navigation', { name: 'Main' }))
    expect(nav.getAllByRole('button').map((button) => button.textContent)).toEqual(['Library', 'Search', 'Connections'])
    expect(nav.getByRole('button', { name: 'Search' }).getAttribute('aria-current')).toBe('page')
    expect(nav.getByRole('button', { name: 'Library' }).getAttribute('aria-current')).toBeNull()
  })

  it('goes to the page that was clicked', async () => {
    const onNavigate = vi.fn()
    render(<Sidebar page="library" onNavigate={onNavigate} />)
    await userEvent.click(screen.getByRole('button', { name: 'Connections' }))
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('connections')
  })

  it('shows what it is given, such as the video, below the navigation and inside the sidebar', () => {
    const { container } = render(
      <Sidebar page="library" onNavigate={vi.fn()}>
        <div data-testid="video" />
      </Sidebar>
    )
    const sidebar = container.querySelector('.sidebar')!
    const video = screen.getByTestId('video')
    expect(sidebar.contains(video)).toBe(true)
    expect(screen.getByRole('navigation', { name: 'Main' }).compareDocumentPosition(video) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('is fine with nothing to show', () => {
    const { container } = render(<Sidebar page="library" onNavigate={vi.fn()} />)
    expect(container.querySelector('.sidebar')?.children).toHaveLength(2)
  })
})
