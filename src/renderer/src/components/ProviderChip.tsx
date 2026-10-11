import type { ProviderStatus } from '@shared/types'
import { ProviderLogo } from './ProviderLogo'

interface Props {
  provider: ProviderStatus
  busy: boolean
  onToggle: (provider: ProviderStatus) => void
}

function describeQuality({ maxQuality }: ProviderStatus): string {
  const codec = maxQuality.codec.toUpperCase()
  if (maxQuality.lossless && maxQuality.bitDepth && maxQuality.sampleRateHz) {
    return `${codec} up to ${maxQuality.bitDepth}-bit / ${maxQuality.sampleRateHz / 1000} kHz`
  }
  return maxQuality.bitrateKbps ? `${codec} up to ${maxQuality.bitrateKbps} kbps` : codec
}

export function ProviderChip({ provider, busy, onToggle }: Props): React.JSX.Element {
  const { name, connected } = provider
  const action = connected ? 'Disconnect' : 'Connect'

  return (
    <li className="chip" data-connected={connected}>
      <ProviderLogo id={provider.id} name={name} />
      <div className="chip-text">
        <span className="chip-name">{name}</span>
        <span className="chip-meta">
          <span className="status-dot" aria-hidden="true" />
          {connected ? 'Connected' : 'Not connected'} · {describeQuality(provider)}
        </span>
      </div>
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
