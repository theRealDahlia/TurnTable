import { createHash } from 'node:crypto'
import { stat } from 'node:fs/promises'
import type { Track, TrackPage } from '@shared/types'
import { mediaUrl } from '@shared/media'
import type { FolderStore } from './folderStore'
import type { ReadMetadata } from './metadata'
import { scanAudioFiles } from './scan'

const PAGE_SIZE = 50

export interface LocalLibraryDeps {
  folders: FolderStore
  readMetadata: ReadMetadata
  scan?: (roots: string[]) => Promise<string[]>
}

/** Stable, path-free id: the renderer asks for tracks by id and never learns or supplies file paths. */
export function trackIdForPath(path: string): string {
  return createHash('sha256').update(path).digest('hex').slice(0, 24)
}

/** The audio files in the user's folders. File names come from a fast scan; tags are read a page at a time. */
export class LocalLibrary {
  private files: string[] = []
  private pathsById = new Map<string, string>()
  private cache = new Map<string, { mtimeMs: number; track: Track }>()
  private scanned = false

  constructor(private readonly deps: LocalLibraryDeps) {}

  get isScanned(): boolean {
    return this.scanned
  }

  /** Re-scans the folders, so files added or removed since the last scan show up. */
  async refresh(): Promise<void> {
    const scan = this.deps.scan ?? scanAudioFiles
    this.files = await scan(await this.deps.folders.list())
    this.pathsById = new Map(this.files.map((path) => [trackIdForPath(path), path]))
    this.scanned = true
  }

  reset(): void {
    this.files = []
    this.pathsById.clear()
    this.cache.clear()
    this.scanned = false
  }

  /** The file behind a track id, or undefined for ids this library never issued. */
  resolve(id: string): string | undefined {
    return this.pathsById.get(id)
  }

  async page(offset: number): Promise<TrackPage> {
    const slice = this.files.slice(offset, offset + PAGE_SIZE)
    const tracks = (await Promise.all(slice.map((path) => this.load(path)))).filter((track) => track !== undefined)
    const end = offset + slice.length
    return { tracks, nextCursor: end < this.files.length ? String(end) : undefined }
  }

  /** Unreadable or corrupt files are skipped rather than failing the whole page. */
  private async load(path: string): Promise<Track | undefined> {
    try {
      const { mtimeMs } = await stat(path)
      const cached = this.cache.get(path)
      if (cached?.mtimeMs === mtimeMs) return cached.track

      const meta = await this.deps.readMetadata(path)
      const id = trackIdForPath(path)
      const track: Track = {
        id,
        providerId: 'local',
        title: meta.title,
        artists: meta.artists,
        album: meta.album,
        durationMs: meta.durationMs,
        artworkUrl: meta.hasArtwork ? mediaUrl('art', id) : undefined,
        quality: meta.quality,
        savedAt: new Date(mtimeMs).toISOString()
      }
      this.cache.set(path, { mtimeMs, track })
      return track
    } catch {
      return undefined
    }
  }
}
