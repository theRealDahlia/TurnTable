import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

/** The music folders the user has added, remembered between launches. */
export class FolderStore {
  constructor(private readonly filePath: string) {}

  async list(): Promise<string[]> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'))
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return []
      throw error
    }
  }

  /** Adds folders, skipping any already covered by an existing folder (and absorbing ones they now cover). */
  async add(folders: string[]): Promise<string[]> {
    const merged = [...(await this.list())]
    for (const folder of folders.map((f) => resolve(f))) {
      if (merged.some((existing) => covers(existing, folder))) continue
      for (let i = merged.length - 1; i >= 0; i--) if (covers(folder, merged[i]!)) merged.splice(i, 1)
      merged.push(folder)
    }
    await this.write(merged)
    return merged
  }

  async clear(): Promise<void> {
    await this.write([])
  }

  private async write(folders: string[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const temp = `${this.filePath}.tmp`
    await writeFile(temp, JSON.stringify(folders))
    await rename(temp, this.filePath)
  }
}

/** True when `parent` is `child` itself or one of its ancestors. */
function covers(parent: string, child: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : parent + sep)
}
