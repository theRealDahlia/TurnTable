import { useEffect, useId, useRef, useState } from 'react'
import { APP_NAME } from '@shared/app'
import { isDocumentFile, LEGAL_DOCUMENTS, type DocumentFile } from '../legal/documents'
import { Markdown } from '../legal/Markdown'

interface Props {
  /** The document to show first. */
  initial: DocumentFile
  onClose: () => void
}

/** The End-User Agreement and Privacy Policy, in a window over the app. */
export function LegalDialog({ initial, onClose }: Props): React.JSX.Element {
  const [file, setFile] = useState<DocumentFile>(initial)
  const titleId = useId()
  const closeButton = useRef<HTMLButtonElement>(null)
  const document_ = LEGAL_DOCUMENTS.find((entry) => entry.file === file) ?? LEGAL_DOCUMENTS[0]!

  useEffect(() => {
    closeButton.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="legal-backdrop" onClick={onClose}>
      <div className="legal-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
        <header className="legal-header">
          <h1 id={titleId}>
            {APP_NAME}: {document_.title}
          </h1>
          <button type="button" ref={closeButton} className="legal-close" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="filters" role="group" aria-label="Document">
          {LEGAL_DOCUMENTS.map((entry) => (
            <button type="button" key={entry.file} className="filter" aria-pressed={entry.file === file} onClick={() => setFile(entry.file)}>
              {entry.title}
            </button>
          ))}
        </div>
        <div className="legal-scroll" tabIndex={0} aria-label={document_.title}>
          <Markdown text={document_.text} onOpenDocument={(target) => isDocumentFile(target) && setFile(target)} />
        </div>
      </div>
    </div>
  )
}
