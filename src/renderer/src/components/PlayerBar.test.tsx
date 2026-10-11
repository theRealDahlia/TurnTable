// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Track } from '@shared/types'
import type { Player } from '../player/usePlayer'
import { PlayerBar } from './PlayerBar'

const track: Track = {
  id: 'a'.repeat(24),
  providerId: 'local',
  title: 'Slow Weather',
  artists: ['North Pier', 'Ana Veliz'],
  durationMs: 200_000,
  quality: { codec: 'flac', lossless: true, bitDepth: 24, sampleRateHz: 96000 },
  artworkUrl: 'turntable-media://art/x'
}

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    track,
    status: 'paused',
    currentTime: 65,
    duration: 200,
    volume: 0.5,
    hasNext: true,
    hasPrevious: true,
    play: vi.fn(),
    toggle: vi.fn(),
    pause: vi.fn(),
    next: vi.fn(),
    previous: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    ...overrides
  }
}

afterEach(cleanup)

describe('PlayerBar', () => {
  it('renders nothing until something has been played', () => {
    const { container } = render(<PlayerBar player={makePlayer({ track: undefined, status: 'idle' })} />)
    expect(container.firstChild).toBeNull()
  })

  it('shows what is playing, with its exact audio format', () => {
    render(<PlayerBar player={makePlayer()} />)
    const bar = within(screen.getByRole('contentinfo', { name: 'Player' }))

    expect(bar.getByText('Slow Weather')).toBeTruthy()
    expect(bar.getByText('North Pier, Ana Veliz')).toBeTruthy()
    expect(bar.getByText('FLAC · 24-bit / 96 kHz')).toBeTruthy()
  })

  it('shows elapsed and total time, and exposes them to assistive tech on the seek slider', () => {
    render(<PlayerBar player={makePlayer()} />)

    expect(screen.getByText('1:05')).toBeTruthy()
    expect(screen.getByText('3:20')).toBeTruthy()
    const seek = screen.getByRole('slider', { name: 'Seek' }) as HTMLInputElement
    expect(seek.value).toBe('65')
    expect(seek.max).toBe('200')
    expect(seek.getAttribute('aria-valuetext')).toBe('1:05 of 3:20')
  })

  it.each([
    ['paused', 'Play'],
    ['idle', 'Play'],
    ['error', 'Play'],
    ['playing', 'Pause'],
    ['loading', 'Pause']
  ] as const)('offers "%s" status the %s button', (status, label) => {
    render(<PlayerBar player={makePlayer({ status })} />)
    expect(screen.getByRole('button', { name: label })).toBeTruthy()
  })

  it('wires the transport buttons to the player', async () => {
    const player = makePlayer()
    render(<PlayerBar player={player} />)

    await userEvent.click(screen.getByRole('button', { name: 'Play' }))
    await userEvent.click(screen.getByRole('button', { name: 'Next track' }))
    await userEvent.click(screen.getByRole('button', { name: 'Previous track' }))

    expect(player.toggle).toHaveBeenCalledOnce()
    expect(player.next).toHaveBeenCalledOnce()
    expect(player.previous).toHaveBeenCalledOnce()
  })

  it('disables Next on the last track but still allows Previous (restart)', () => {
    render(<PlayerBar player={makePlayer({ hasNext: false, hasPrevious: false })} />)
    expect((screen.getByRole('button', { name: 'Next track' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Previous track' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('seeks and changes volume from the sliders', () => {
    const player = makePlayer()
    render(<PlayerBar player={player} />)

    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '120' } })
    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '0.8' } })

    expect(player.seek).toHaveBeenCalledWith(120)
    expect(player.setVolume).toHaveBeenCalledWith(0.8)
    expect((screen.getByRole('slider', { name: 'Volume' }) as HTMLInputElement).value).toBe('0.5')
  })

  it('keeps the seek slider valid before the duration is known', () => {
    render(<PlayerBar player={makePlayer({ duration: 0, currentTime: 0 })} />)
    const seek = screen.getByRole('slider', { name: 'Seek' }) as HTMLInputElement
    expect(seek.max).toBe('0')
    expect(seek.value).toBe('0')
  })

  it('announces playback errors', () => {
    render(<PlayerBar player={makePlayer({ status: 'error', error: 'This audio format is not supported.' })} />)
    expect(screen.getByRole('alert').textContent).toBe('This audio format is not supported.')
  })

  it('copes with a track that has no artwork or known format', () => {
    render(<PlayerBar player={makePlayer({ track: { ...track, artworkUrl: undefined, quality: undefined } })} />)
    expect(screen.queryByText(/FLAC/)).toBeNull()
    expect(screen.getByText('Slow Weather')).toBeTruthy()
  })
})
