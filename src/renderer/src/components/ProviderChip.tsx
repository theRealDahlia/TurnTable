import type { ProviderStatus } from '@shared/types'
import { codecName } from '../lib/quality'
import { ProviderLogo } from './ProviderLogo'

interface Props {
  provider: ProviderStatus
  busy: boolean
  onToggle: (provider: ProviderStatus) => void
  /** Local files only: choose more folders while already connected. */
  onAddFolders: (provider: ProviderStatus) => void
}

function describeQuality({ maxQuality }: ProviderStatus): string {
  const codec = codecName(maxQuality.codec)
  if (maxQuality.lossless && maxQuality.bitDepth && maxQuality.sampleRateHz) {
    return `${codec} up to ${maxQuality.bitDepth}-bit / ${maxQuality.sampleRateHz / 1000} kHz`
  }
  return maxQuality.bitrateKbps ? `${codec} up to ${maxQuality.bitrateKbps} kbps` : codec
}

export function ProviderChip({ provider, busy, onToggle, onAddFolders }: Props): React.JSX.Element {
  const { name, connected } = provider
  const isLocal = provider.id === 'local'
  // Local files has no account: "connecting" means choosing the folders to read.
  const reconnect = connected && provider.needsReauthorization === true
  const action = isLocal
    ? connected ? 'Remove folders' : 'Choose folders'
    : reconnect ? 'Reconnect' : connected ? 'Disconnect' : 'Connect'

  return (
    <li className="chip" data-connected={connected}>
      <ProviderLogo id={provider.id} name={name} />
      <div className="chip-text">
        <span className="chip-name">{name}</span>
        <span className="chip-meta">
          <span className="status-dot" aria-hidden="true" />
          <span className="chip-status">{reconnect ? 'Reconnect to enable playback' : connected ? 'Connected' : 'Not connected'}</span>
          <span className="chip-sep" aria-hidden="true">
            ·
          </span>
          <span className="chip-quality">{describeQuality(provider)}</span>
        </span>
      </div>
      {isLocal && connected && (
        <button
          type="button"
          className="chip-action chip-secondary"
          aria-label={`Add folders to ${name}`}
          disabled={busy}
          onClick={() => onAddFolders(provider)}
        >
          Add folders
        </button>
      )}
      <button
        type="button"
        className="chip-action"
        aria-label={`${action} ${name}`}
        disabled={busy}
        onClick={() => onToggle(provider)}
      >
        {busy ? 'Working…' : action}
      </button>
    </li>
  )
}
