import { useEffect, useId, useRef, useState } from 'react'
import type { ProviderId } from '@shared/types'
import { ChevronDownIcon, RefreshIcon } from './icons'
import { ProviderLogo } from './ProviderLogo'

interface Props {
  /** The connected services, which can each be refreshed on their own. */
  providers: { id: ProviderId; name: string }[]
  /** Something is loading, so another refresh has to wait. */
  busy: boolean
  /** A refresh is replacing lists that are on screen. */
  refreshing: boolean
  /** Called with a service to refresh just that one, or with nothing to refresh them all. */
  onRefresh: (id?: ProviderId) => void
}

/** The Library's Refresh button: opens a menu to refresh every service at once, or any one of them. */
export function RefreshMenu({ providers, busy, refreshing, onRefresh }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  const items = (): HTMLButtonElement[] => [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]

  // Opening puts the keyboard on the first choice.
  useEffect(() => {
    if (open) root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [open])

  // Clicking anywhere else, or moving focus out of the menu, closes it.
  useEffect(() => {
    if (!open) return
    const close = (event: Event): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])

  const close = (restoreFocus: boolean): void => {
    setOpen(false)
    if (restoreFocus) trigger.current?.focus()
  }

  const choose = (id?: ProviderId): void => {
    close(true)
    if (id === undefined) onRefresh()
    else onRefresh(id)
  }

  const onMenuKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const all = items()
    const at = all.indexOf(document.activeElement as HTMLButtonElement)
    const move = (index: number): void => {
      event.preventDefault()
      all[(index + all.length) % all.length]?.focus()
    }
    switch (event.key) {
      case 'ArrowDown':
        return move(at + 1)
      case 'ArrowUp':
        return move(at - 1)
      case 'Home':
        return move(0)
      case 'End':
        return move(all.length - 1)
      case 'Escape':
        event.preventDefault()
        return close(true)
      case 'Tab':
        return close(false)
    }
  }

  const onTriggerKey = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === 'ArrowDown' && !open) {
      event.preventDefault()
      setOpen(true)
    }
  }

  return (
    <div className="refresh-menu" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="refresh-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-busy={refreshing}
        disabled={busy}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKey}
      >
        <RefreshIcon className={refreshing ? 'spinning' : undefined} />
        {refreshing ? 'Refreshing…' : 'Refresh'}
        <ChevronDownIcon className="refresh-chevron" />
      </button>

      {open && (
        <div id={menuId} className="refresh-list" role="menu" aria-label="Refresh" onKeyDown={onMenuKey}>
          <button type="button" role="menuitem" className="refresh-item" onClick={() => choose()}>
            <RefreshIcon />
            Refresh all
          </button>
          <div className="refresh-divider" role="separator" />
          {providers.map((provider) => (
            <button type="button" role="menuitem" className="refresh-item" key={provider.id} onClick={() => choose(provider.id)}>
              <span aria-hidden="true">
                <ProviderLogo id={provider.id} name={provider.name} size="sm" />
              </span>
              Refresh {provider.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
