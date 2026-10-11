const SKELETON_ROWS = 8

interface Props {
  /** Leave room for the extra column that rows with a Save button have. */
  withSave?: boolean
}

/** Placeholder rows shown while the first tracks are on their way. */
export function TrackSkeleton({ withSave = false }: Props): React.JSX.Element {
  return (
    <ul className="tracks" aria-hidden="true">
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <li className="skeleton-row" key={index}>
          <span className="skeleton-block skeleton-art" />
          <span className="skeleton-lines">
            <span className="skeleton-block" style={{ width: `${55 + ((index * 17) % 30)}%` }} />
            <span className="skeleton-block" style={{ width: `${30 + ((index * 11) % 25)}%` }} />
          </span>
          <span className="skeleton-block" style={{ width: '45%' }} />
          <span className="skeleton-block" style={{ width: '60%' }} />
          <span />
          {withSave && <span />}
          <span className="skeleton-block" style={{ width: '70%' }} />
        </li>
      ))}
    </ul>
  )
}
