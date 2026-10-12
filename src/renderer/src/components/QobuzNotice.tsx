import { QOBUZ_NOTICE } from '@shared/qobuz'

/** The sentence Qobuz's API terms require wherever the app uses its API. */
export function QobuzNotice({ className = 'qobuz-notice' }: { className?: string }): React.JSX.Element {
  return <p className={className}>{QOBUZ_NOTICE}</p>
}
