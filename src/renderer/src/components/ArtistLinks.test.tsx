// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderStatus, Track } from '@shared/types'
import { TrackRow } from './TrackRow'

const TIDAL: ProviderStatus = { id: 'tidal', name: 'TIDAL', authKind: 'oauth-pkce', playback: 'sdk', maxQuality: { codec: 'flac', lossless: true }, connected: true }
const track: Track = { id: 'abc', providerId: 'tidal', title: 'Under Pressure', artists: ['Queen', 'David Bowie'], durationMs: 248_000 }

afterEach(cleanup)

const row = (props: Partial<React.ComponentProps<typeof TrackRow>> = {}) => {
  const onPlay = vi.fn()
  render(
    <ul>
      <TrackRow track={track} provider={TIDAL} current={false} playing={false} onPlay={onPlay} {...props} />
    </ul>
  )
  return { onPlay }
}

describe('artist names in a track row', () => {
  it("open that artist's page on the track's own service", async () => {
    const onOpenArtist = vi.fn()
    row({ onOpenArtist })

    await userEvent.click(screen.getByRole('button', { name: 'David Bowie' }))

    expect(onOpenArtist).toHaveBeenCalledExactlyOnceWith({ providerId: 'tidal', name: 'David Bowie' })
  })

  it('keep the full list in the hover text, separated by commas', () => {
    row({ onOpenArtist: vi.fn() })
    const names = document.querySelector('.track-artists')
    expect(names?.textContent).toBe('Queen, David Bowie')
    expect(names?.getAttribute('title')).toBe('Queen, David Bowie')
  })

  it('do not play the song when double-clicked, though the rest of the row does', async () => {
    const { onPlay } = row({ onOpenArtist: vi.fn() })

    await userEvent.dblClick(screen.getByRole('button', { name: 'Queen' }))
    expect(onPlay).not.toHaveBeenCalled()

    await userEvent.dblClick(screen.getByText('Under Pressure'))
    expect(onPlay).toHaveBeenCalledExactlyOnceWith(track)
  })

  it('are plain text where no artist page can open', () => {
    row()
    expect(screen.queryByRole('button', { name: 'Queen' })).toBeNull()
    expect(screen.getByText('Queen, David Bowie')).toBeTruthy()
  })
})
