import eula from '../../../../docs/EULA.md?raw'
import privacy from '../../../../docs/PRIVACY.md?raw'

export type DocumentFile = 'EULA.md' | 'PRIVACY.md'

export interface LegalDocument {
  file: DocumentFile
  title: string
  text: string
}

/** The documents users agree to, shown as they are in the repository's docs folder. */
export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [
  { file: 'EULA.md', title: 'End-User Agreement', text: eula },
  { file: 'PRIVACY.md', title: 'Privacy Policy', text: privacy }
]

export const isDocumentFile = (file: string): file is DocumentFile => LEGAL_DOCUMENTS.some((document) => document.file === file)
