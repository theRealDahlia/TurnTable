// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TermsGate } from './TermsGate'

afterEach(cleanup)

describe('TermsGate', () => {
  it('lets the user continue only after agreeing', async () => {
    const onAccept = vi.fn()
    render(<TermsGate onAccept={onAccept} />)
    const proceed = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement
    expect(proceed.disabled).toBe(true)

    await userEvent.click(screen.getByRole('checkbox'))
    expect(proceed.disabled).toBe(false)
    await userEvent.click(proceed)
    expect(onAccept).toHaveBeenCalledOnce()

    await userEvent.click(screen.getByRole('checkbox'))
    expect(proceed.disabled).toBe(true)
  })

  it('opens either document to read, and closes it again', async () => {
    render(<TermsGate onAccept={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Read the End-User Agreement' }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByRole('heading', { level: 1, name: 'Muze: End-User Agreement' })).toBeTruthy()
    expect(dialog.getByRole('heading', { name: '2. Licence' })).toBeTruthy()

    await userEvent.click(dialog.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Read the Privacy Policy' }))
    expect(within(screen.getByRole('dialog')).getByRole('heading', { name: 'The short version' })).toBeTruthy()
  })

  it('follows a link in the agreement to the privacy policy', async () => {
    render(<TermsGate onAccept={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Read the End-User Agreement' }))

    await userEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Privacy Policy' }).find((b) => b.className === 'legal-link')!)

    expect(within(screen.getByRole('dialog')).getByRole('heading', { level: 1, name: 'Muze: Privacy Policy' })).toBeTruthy()
  })

  it("says it is not affiliated with the services it works with", () => {
    render(<TermsGate onAccept={vi.fn()} />)
    expect(screen.getByText(/not affiliated with Spotify, YouTube, Google, TIDAL or Qobuz/)).toBeTruthy()
  })
})
