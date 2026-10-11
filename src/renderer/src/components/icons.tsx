/** Small inline icons shared by the sidebar, library and player. They take their color from the text around them. */
const FILLED = { viewBox: '0 0 24 24', fill: 'currentColor', 'aria-hidden': true } as const
const STROKED = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true
} as const

interface IconProps {
  className?: string
}

export const PlayIcon = ({ className }: IconProps): React.JSX.Element => (
  <svg {...FILLED} className={className}>
    <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
  </svg>
)

export const PauseIcon = ({ className }: IconProps): React.JSX.Element => (
  <svg {...FILLED} className={className}>
    <rect x="6" y="5" width="4" height="14" rx="1" />
    <rect x="14" y="5" width="4" height="14" rx="1" />
  </svg>
)

export const PreviousIcon = ({ className }: IconProps): React.JSX.Element => (
  <svg {...FILLED} className={className}>
    <path d="M6 5h2v14H6zM20 5.6v12.8a.8.8 0 0 1-1.25.66L9.5 12.66a.8.8 0 0 1 0-1.32l9.25-6.4A.8.8 0 0 1 20 5.6Z" />
  </svg>
)

export const NextIcon = ({ className }: IconProps): React.JSX.Element => (
  <svg {...FILLED} className={className}>
    <path d="M16 5h2v14h-2zM4 5.6v12.8a.8.8 0 0 0 1.25.66l9.25-6.4a.8.8 0 0 0 0-1.32L5.25 4.94A.8.8 0 0 0 4 5.6Z" />
  </svg>
)

export const SearchIcon = ({ className }: IconProps): React.JSX.Element => (
  <svg {...STROKED} className={className}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </svg>
)

export const ClockIcon = ({ className }: IconProps): React.JSX.Element => (
  <svg {...STROKED} className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
)

/** The app's mark: five rounded bars of different heights, like a sound wave. */
export const BrandMark = ({ className }: IconProps): React.JSX.Element => (
  <svg {...STROKED} strokeWidth={2.4} className={className}>
    <path d="M3.5 9v6M7.75 5.5v13M12 1.5v21M16.25 4v16M20.5 8v8" />
  </svg>
)

export const SpeakerIcon = ({ className }: IconProps): React.JSX.Element => (
  <svg {...STROKED} className={className}>
    <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Z" fill="currentColor" />
    <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </svg>
)

/** Stands in for artwork a track doesn't have. */
export const NoteIcon = ({ className }: IconProps): React.JSX.Element => (
  <svg {...STROKED} className={className}>
    <path d="M9 18V5.5l10-2V16" />
    <circle cx="6.5" cy="18" r="2.5" fill="currentColor" />
    <circle cx="16.5" cy="16" r="2.5" fill="currentColor" />
  </svg>
)

export const RefreshIcon = ({ className }: IconProps): React.JSX.Element => (
  <svg {...STROKED} className={className}>
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M8 16H3v5" />
  </svg>
)

export const ChevronDownIcon = ({ className }: IconProps): React.JSX.Element => (
  <svg {...STROKED} className={className}>
    <path d="m6 9 6 6 6-6" />
  </svg>
)

/** A heart that is solid once the track is saved. */
export const HeartIcon = ({ className, filled = false }: IconProps & { filled?: boolean }): React.JSX.Element => (
  <svg {...STROKED} fill={filled ? 'currentColor' : 'none'} className={className}>
    <path d="M12 20.5s-7.5-4.6-9.2-9.4C1.7 7.7 3.7 4.5 7 4.5c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 3.3 0 5.3 3.2 4.2 6.6-1.7 4.8-9.2 9.4-9.2 9.4Z" />
  </svg>
)

export const ShuffleIcon = ({ className }: IconProps): React.JSX.Element => (
  <svg {...STROKED} className={className}>
    <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22" />
    <path d="m18 2 4 4-4 4" />
    <path d="M2 6h1.9c1.5 0 2.9.9 3.6 2.2" />
    <path d="M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8" />
    <path d="m18 14 4 4-4 4" />
  </svg>
)
