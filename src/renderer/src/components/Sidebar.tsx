export type Page = 'library' | 'connections'

interface Props {
  page: Page
  onNavigate: (page: Page) => void
}

const ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true
} as const

const ITEMS: { page: Page; label: string; icon: React.JSX.Element }[] = [
  {
    page: 'library',
    label: 'Library',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M4 5v14M9 5v14M14.5 6.5l4.2 12.7 1.9-.6L16.4 5.9z" />
      </svg>
    )
  },
  {
    page: 'connections',
    label: 'Connections',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M9.5 14.5l5-5M8 11l-2.2 2.2a3.2 3.2 0 0 0 4.5 4.5L12.5 15.5M16 13l2.2-2.2a3.2 3.2 0 0 0-4.5-4.5L11.5 8.5" />
      </svg>
    )
  }
]

/** A record on a turntable: the outer groove, a highlight, and the spindle. */
function BrandMark(): React.JSX.Element {
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 5.2a6.8 6.8 0 0 1 6.8 6.8" opacity="0.55" />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function Sidebar({ page, onNavigate }: Props): React.JSX.Element {
  return (
    <aside className="sidebar">
      <div className="brand">
        <BrandMark />
        <span>TurnTable</span>
      </div>
      <nav aria-label="Main">
        {ITEMS.map((item) => (
          <button
            type="button"
            key={item.page}
            className="nav-item"
            aria-current={item.page === page ? 'page' : undefined}
            onClick={() => onNavigate(item.page)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>
    </aside>
  )
}
