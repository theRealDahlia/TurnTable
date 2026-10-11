// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RefreshMenu } from './RefreshMenu'

const providers = [
  { id: 'spotify' as const, name: 'Spotify' },
  { id: 'youtubeMusic' as const, name: 'YouTube Music' },
  { id: 'local' as const, name: 'Local files' }
]

afterEach(cleanup)

function setup(props: Partial<React.ComponentProps<typeof RefreshMenu>> = {}) {
  const onRefresh = vi.fn()
  const view = render(
    <div>
      <RefreshMenu providers={providers} busy={false} refreshing={false} onRefresh={onRefresh} {...props} />
      <button type="button">Elsewhere</button>
    </div>
  )
  const trigger = (): HTMLElement => screen.getByRole('button', { name: /^Refresh/ })
  const menu = (): HTMLElement | null => screen.queryByRole('menu')
  const items = (): HTMLElement[] => within(screen.getByRole('menu')).getAllByRole('menuitem')
  return { ...view, onRefresh, trigger, menu, items }
}

describe('RefreshMenu', () => {
  it('is a closed menu button until it is pressed', () => {
    const { trigger, menu } = setup()
    expect(trigger().getAttribute('aria-haspopup')).toBe('menu')
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    expect(menu()).toBeNull()
  })

  it('lists Refresh all first, then each service by name', async () => {
    const { trigger, items } = setup()
    await userEvent.click(trigger())

    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(items().map((item) => item.textContent)).toEqual(['Refresh all', 'Refresh Spotify', 'Refresh YouTube Music', 'Refresh Local files'])
    expect(screen.getByRole('separator')).toBeTruthy()
    expect(trigger().getAttribute('aria-controls')).toBe(screen.getByRole('menu').id)
  })

  it("does not read the services' logos out as part of each choice", async () => {
    const { trigger } = setup()
    await userEvent.click(trigger())
    expect(screen.getByRole('menuitem', { name: 'Refresh Spotify' })).toBeTruthy()
  })

  it('refreshes everything from Refresh all, closes, and gives focus back to the button', async () => {
    const { trigger, onRefresh, menu } = setup()
    await userEvent.click(trigger())
    await userEvent.click(screen.getByRole('menuitem', { name: 'Refresh all' }))

    expect(onRefresh).toHaveBeenCalledExactlyOnceWith()
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(trigger())
  })

  it('refreshes one service by its id', async () => {
    const { trigger, onRefresh } = setup()
    await userEvent.click(trigger())
    await userEvent.click(screen.getByRole('menuitem', { name: 'Refresh YouTube Music' }))
    expect(onRefresh).toHaveBeenCalledExactlyOnceWith('youtubeMusic')
  })

  it('closes when the button is pressed again', async () => {
    const { trigger, menu } = setup()
    await userEvent.click(trigger())
    await userEvent.click(trigger())
    expect(menu()).toBeNull()
  })

  it('closes when something else is clicked, without refreshing', async () => {
    const { trigger, menu, onRefresh } = setup()
    await userEvent.click(trigger())
    await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }))
    expect(menu()).toBeNull()
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('stays open when the menu itself is clicked outside the choices', async () => {
    const { trigger, menu } = setup()
    await userEvent.click(trigger())
    await userEvent.click(screen.getByRole('separator'))
    expect(menu()).not.toBeNull()
  })

  describe('with the keyboard', () => {
    it('opens with the down arrow and starts on the first choice', async () => {
      const { trigger, items } = setup()
      trigger().focus()
      await userEvent.keyboard('{ArrowDown}')
      expect(document.activeElement).toBe(items()[0])
    })

    it('opens with Enter or Space, and starts on the first choice', async () => {
      const { trigger, items, menu } = setup()
      trigger().focus()
      await userEvent.keyboard('{Enter}')
      expect(document.activeElement).toBe(items()[0])
      await userEvent.keyboard('{Escape}')
      expect(menu()).toBeNull()
      await userEvent.keyboard(' ')
      expect(document.activeElement).toBe(items()[0])
    })

    it('moves through the choices, wrapping at both ends', async () => {
      const { trigger, items } = setup()
      trigger().focus()
      await userEvent.keyboard('{ArrowDown}')
      await userEvent.keyboard('{ArrowDown}')
      expect(document.activeElement).toBe(items()[1])
      await userEvent.keyboard('{ArrowDown}{ArrowDown}')
      expect(document.activeElement).toBe(items()[3])
      await userEvent.keyboard('{ArrowDown}')
      expect(document.activeElement).toBe(items()[0])
      await userEvent.keyboard('{ArrowUp}')
      expect(document.activeElement).toBe(items()[3])
    })

    it('jumps to the first and last with Home and End', async () => {
      const { trigger, items } = setup()
      trigger().focus()
      await userEvent.keyboard('{ArrowDown}{End}')
      expect(document.activeElement).toBe(items()[3])
      await userEvent.keyboard('{Home}')
      expect(document.activeElement).toBe(items()[0])
    })

    it('chooses with Enter', async () => {
      const { trigger, onRefresh } = setup()
      trigger().focus()
      await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')
      expect(onRefresh).toHaveBeenCalledExactlyOnceWith('spotify')
    })

    it('closes with Escape and gives focus back to the button', async () => {
      const { trigger, menu, onRefresh } = setup()
      trigger().focus()
      await userEvent.keyboard('{ArrowDown}{Escape}')
      expect(menu()).toBeNull()
      expect(document.activeElement).toBe(trigger())
      expect(onRefresh).not.toHaveBeenCalled()
    })

    it('closes when tabbing away', async () => {
      const { trigger, menu } = setup()
      trigger().focus()
      await userEvent.keyboard('{ArrowDown}{Tab}')
      expect(menu()).toBeNull()
    })
  })

  describe('while working', () => {
    it('cannot be opened while something is loading', async () => {
      const { trigger, menu } = setup({ busy: true })
      expect((trigger() as HTMLButtonElement).disabled).toBe(true)
      await userEvent.click(trigger())
      expect(menu()).toBeNull()
    })

    it('says it is refreshing, with a spinning icon', () => {
      setup({ busy: true, refreshing: true })
      const busy = screen.getByRole('button', { name: 'Refreshing…' })
      expect(busy.getAttribute('aria-busy')).toBe('true')
      expect(busy.querySelector('.spinning')).not.toBeNull()
    })

    it('is idle otherwise', () => {
      const { trigger } = setup()
      expect(trigger().getAttribute('aria-busy')).toBe('false')
      expect(trigger().querySelector('.spinning')).toBeNull()
    })
  })
})
