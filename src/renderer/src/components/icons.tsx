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

/** A record on a turntable: the outer groove, a highlight, and the spindle. */
export const BrandMark = ({ className }: IconProps): React.JSX.Element => (
  <svg {...STROKED} className={className}>
    <circle cx="12" cy="12" r="9.5" />
    <path d="M12 5.2a6.8 6.8 0 0 1 6.8 6.8" opacity="0.55" />
    <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
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
