// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BrandMark } from './icons'

afterEach(cleanup)

describe('BrandMark', () => {
  it('is five rounded bars of different heights, centred on the same line', () => {
    const { container } = render(<BrandMark />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('stroke-linecap')).toBe('round')
    expect(svg.getAttribute('aria-hidden')).toBe('true')

    const bars = [...(svg.querySelector('path')!.getAttribute('d') ?? '').matchAll(/M([\d.]+) ([\d.]+)v([\d.]+)/g)].map(([, x, top, length]) => ({
      x: Number(x),
      top: Number(top),
      length: Number(length)
    }))
    expect(bars).toHaveLength(5)
    // Every bar is centred on the middle of the 24-unit mark, so they read as one wave.
    for (const bar of bars) expect(bar.top + bar.length / 2).toBe(12)
    // The heights differ, rising to a peak and falling away.
    const heights = bars.map((bar) => bar.length)
    expect(new Set(heights).size).toBeGreaterThan(3)
    expect(Math.max(...heights)).toBe(heights[2])
    // And they stay inside the mark, round caps included.
    for (const bar of bars) {
      expect(bar.top - 1.2).toBeGreaterThanOrEqual(0)
      expect(bar.top + bar.length + 1.2).toBeLessThanOrEqual(24)
    }
  })

  it('takes the colour of the text around it, so it follows the theme', () => {
    const { container } = render(<BrandMark className="brand-mark" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('stroke')).toBe('currentColor')
    expect(svg.getAttribute('class')).toBe('brand-mark')
  })
})
