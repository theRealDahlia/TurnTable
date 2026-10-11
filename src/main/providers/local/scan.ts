import { readdir } from 'node:fs/promises'
import { extname, join } from 'node:path'

/** Formats music-metadata can read and Chromium can decode. */
export const AUDIO_EXTENSIONS = new Set(['.flac', '.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.aif', '.aiff'])

export function isAudioFile(path: string): boolean {
  return AUDIO_EXTENSIONS.has(extname(path).toLowerCase())
}

/**
 * Finds audio files under the given folders, sorted by path. Hidden entries are skipped, symlinked
 * folders are not followed (so loops can't hang the scan), and unreadable folders are ignored.
 */
export async function scanAudioFiles(roots: string[]): Promise<string[]> {
  const found = new Set<string>()

  async function walk(dir: string): Promise<void> {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    await Promise.all(
      entries
        .filter((entry) => !entry.name.startsWith('.'))
        .map(async (entry) => {
          const path = join(dir, entry.name)
          if (entry.isDirectory()) await walk(path)
          else if (entry.isFile() && isAudioFile(path)) found.add(path)
        })
    )
  }

  await Promise.all(roots.map(walk))
  return [...found].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}
