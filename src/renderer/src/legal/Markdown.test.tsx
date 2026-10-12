// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Markdown, parseBlocks } from './Markdown'

afterEach(cleanup)

describe('parseBlocks', () => {
  it('splits headings, quotes, lists, tables and paragraphs', () => {
    const blocks = parseBlocks(
      ['# Title', '', '> Draft', '> notice', '', 'One', 'line.', '', '- a', '- b', '', '| X | Y |', '| --- | --- |', '| 1 | 2 |', '', '## Next'].join('\n')
    )
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Title' },
      { kind: 'quote', text: 'Draft notice' },
      { kind: 'paragraph', text: 'One\nline.' },
      { kind: 'list', items: ['a', 'b'] },
      { kind: 'table', head: ['X', 'Y'], rows: [['1', '2']] },
      { kind: 'heading', level: 2, text: 'Next' }
    ])
  })
})

describe('Markdown', () => {
  it('shows headings one level down, so the dialog title stays the top heading', () => {
    render(<Markdown text={'# Muze Privacy Policy\n\n## Security'} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Muze Privacy Policy' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 3, name: 'Security' })).toBeTruthy()
  })

  it('shows bold and code, and tables as tables', () => {
    render(<Markdown text={'We keep **nothing** in `memory.txt`.\n\n| What | Why |\n| --- | --- |\n| Tokens | Sign-in |'} />)
    expect(screen.getByText('nothing').tagName).toBe('STRONG')
    expect(screen.getByText('memory.txt').tagName).toBe('CODE')
    const table = within(screen.getByRole('table'))
    expect(table.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['What', 'Why'])
    expect(table.getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['Tokens', 'Sign-in'])
  })

  it('opens https links in a new window, safely', () => {
    render(<Markdown text="See [the terms](https://www.youtube.com/t/terms)." />)
    const link = screen.getByRole('link', { name: 'the terms' })
    expect(link.getAttribute('href')).toBe('https://www.youtube.com/t/terms')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noreferrer')
  })

  it('turns a link to another document into a button that asks for it', async () => {
    const onOpenDocument = vi.fn()
    render(<Markdown text="Read the [Privacy Policy](PRIVACY.md)." onOpenDocument={onOpenDocument} />)
    await userEvent.click(screen.getByRole('button', { name: 'Privacy Policy' }))
    expect(onOpenDocument).toHaveBeenCalledExactlyOnceWith('PRIVACY.md')
  })

  it.each([
    ['a script address', '[click](javascript:void0)'],
    ['an unencrypted address', '[click](http://example.com)'],
    ['a document link nobody handles', '[click](PRIVACY.md)']
  ])('shows only the words of %s, never a live link', (_label, text) => {
    render(<Markdown text={text} />)
    expect(screen.getByText('click')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('never turns text into HTML', () => {
    const { container } = render(<Markdown text={'<img src=x onerror=alert(1)> <script>bad()</script>'} />)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    expect(container.textContent).toContain('<script>bad()</script>')
  })
})
