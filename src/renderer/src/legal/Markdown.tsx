import { Fragment } from 'react'

interface Props {
  text: string
  /** Called when the text links to another document, e.g. `PRIVACY.md`. */
  onOpenDocument?: (file: string) => void
}

type Block =
  | { kind: 'heading'; level: 1 | 2 | 3; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'paragraph'; text: string }

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim())

/** Splits the few kinds of Markdown the legal documents use into blocks. Anything else is plain paragraphs. */
export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]!
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (line.trim() === '') {
      index++
    } else if (heading) {
      blocks.push({ kind: 'heading', level: heading[1]!.length as 1 | 2 | 3, text: heading[2]! })
      index++
    } else if (line.startsWith('>')) {
      const quoted: string[] = []
      while (index < lines.length && lines[index]!.startsWith('>')) quoted.push(lines[index++]!.replace(/^>\s?/, ''))
      blocks.push({ kind: 'quote', text: quoted.join(' ').trim() })
    } else if (/^[-*]\s+/.test(line)) {
      const items: string[] = []
      while (index < lines.length && /^[-*]\s+/.test(lines[index]!)) items.push(lines[index++]!.replace(/^[-*]\s+/, ''))
      blocks.push({ kind: 'list', items })
    } else if (line.trim().startsWith('|')) {
      const rows: string[][] = []
      while (index < lines.length && lines[index]!.trim().startsWith('|')) rows.push(cells(lines[index++]!))
      const [head = [], , ...body] = rows
      blocks.push({ kind: 'table', head, rows: body })
    } else {
      const paragraph: string[] = []
      while (index < lines.length && lines[index]!.trim() !== '' && !/^(#{1,3}\s|>|[-*]\s|\|)/.test(lines[index]!.trim())) {
        paragraph.push(lines[index++]!.trim())
      }
      // Lines stay lines, so a few short lines in a row (date, name, contact) don't run together.
      blocks.push({ kind: 'paragraph', text: paragraph.join('\n') })
    }
  }
  return blocks
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/

/** Bold, code and links. A link is only live if it goes to an https address or to another document; otherwise its text is shown. */
function Inline({ text, onOpenDocument }: { text: string; onOpenDocument?: (file: string) => void }): React.JSX.Element {
  return (
    <>
      {text.split(INLINE).map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          return <strong key={i}>{<Inline text={part.slice(2, -2)} onOpenDocument={onOpenDocument} />}</strong>
        }
        if (part.startsWith('`') && part.endsWith('`') && part.length > 2) return <code key={i}>{part.slice(1, -1)}</code>
        const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
        if (link) {
          const [, label, target] = link as unknown as [string, string, string]
          if (target.startsWith('https://')) {
            return (
              <a key={i} href={target} target="_blank" rel="noreferrer">
                {label}
              </a>
            )
          }
          if (/^[A-Za-z0-9_-]+\.md$/.test(target) && onOpenDocument) {
            return (
              <button type="button" className="legal-link" key={i} onClick={() => onOpenDocument(target)}>
                {label}
              </button>
            )
          }
          return <Fragment key={i}>{label}</Fragment>
        }
        return <Fragment key={i}>{part}</Fragment>
      })}
    </>
  )
}

/** Shows one of the app's legal documents. It builds React elements, never HTML, so nothing in the text can run. */
export function Markdown({ text, onOpenDocument }: Props): React.JSX.Element {
  const inline = (value: string): React.JSX.Element => <Inline text={value} onOpenDocument={onOpenDocument} />
  return (
    <div className="legal-text">
      {parseBlocks(text).map((block, i) => {
        switch (block.kind) {
          case 'heading': {
            const Tag = (`h${block.level + 1}` as 'h2' | 'h3' | 'h4')
            return <Tag key={i}>{inline(block.text)}</Tag>
          }
          case 'quote':
            return <blockquote key={i}>{inline(block.text)}</blockquote>
          case 'list':
            return (
              <ul key={i}>
                {block.items.map((item, j) => (
                  <li key={j}>{inline(item)}</li>
                ))}
              </ul>
            )
          case 'table':
            return (
              <div className="legal-table" key={i}>
                <table>
                  <thead>
                    <tr>
                      {block.head.map((cell, j) => (
                        <th key={j}>{inline(cell)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, j) => (
                      <tr key={j}>
                        {row.map((cell, k) => (
                          <td key={k}>{inline(cell)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          case 'paragraph':
            return <p key={i}>{inline(block.text)}</p>
        }
      })}
    </div>
  )
}
