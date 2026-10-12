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
    setShuffle: vi.fn(),
    clear: vi.fn(),
    shuffle: false,
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

  describe('slider fill', () => {
    const fillOf = (name: string): string => (screen.getByRole('slider', { name }) as HTMLInputElement).style.getPropertyValue('--progress')

    it('fills the seek bar up to the playback position', () => {
      render(<PlayerBar player={makePlayer({ currentTime: 65, duration: 200 })} />)
      expect(fillOf('Seek')).toBe('32.5%')
    })

    it('fills the volume bar up to the volume', () => {
      render(<PlayerBar player={makePlayer({ volume: 0.4 })} />)
      expect(fillOf('Volume')).toBe('40%')
    })

    it.each([
      ['an unknown duration', { currentTime: 30, duration: 0 }, '0%'],
      ['a position past the end', { currentTime: 500, duration: 200 }, '100%'],
      ['a negative position', { currentTime: -5, duration: 200 }, '0%'],
      ['a position that is not a number', { currentTime: Number.NaN, duration: 200 }, '0%']
    ])('stays within 0-100%% for %s', (_label, state, expected) => {
      render(<PlayerBar player={makePlayer(state)} />)
      expect(fillOf('Seek')).toBe(expected)
    })

    it('shows a speaker icon next to the volume control, hidden from assistive technology', () => {
      const { container } = render(<PlayerBar player={makePlayer()} />)
      const icon = container.querySelector('.player-volume svg')
      expect(icon).not.toBeNull()
      expect(icon!.getAttribute('aria-hidden')).toBe('true')
    })
  })
})

describe('PlayerBar shuffle', () => {
  it('has a Shuffle button, off to begin with', () => {
    render(<PlayerBar player={makePlayer({ shuffle: false })} />)
    const button = screen.getByRole('button', { name: 'Shuffle' })
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button.getAttribute('title')).toBe('Shuffle is off')
  })

  it('shows when shuffle is on', () => {
    render(<PlayerBar player={makePlayer({ shuffle: true })} />)
    const button = screen.getByRole('button', { name: 'Shuffle', pressed: true })
    expect(button.getAttribute('title')).toBe('Shuffle is on')
  })

  it('switches shuffle on, and off again', async () => {
    const off = makePlayer({ shuffle: false })
    render(<PlayerBar player={off} />)
    await userEvent.click(screen.getByRole('button', { name: 'Shuffle' }))
    expect(off.setShuffle).toHaveBeenCalledExactlyOnceWith(true)

    cleanup()
    const on = makePlayer({ shuffle: true })
    render(<PlayerBar player={on} />)
    await userEvent.click(screen.getByRole('button', { name: 'Shuffle' }))
    expect(on.setShuffle).toHaveBeenCalledExactlyOnceWith(false)
  })

  it('sits before the skip buttons, which stay as they were', () => {
    render(<PlayerBar player={makePlayer({ status: 'playing' })} />)
    const names = within(screen.getByRole('contentinfo', { name: 'Player' }))
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label'))
      .slice(0, 4)
    expect(names).toEqual(['Shuffle', 'Previous track', 'Pause', 'Next track'])
  })
})
