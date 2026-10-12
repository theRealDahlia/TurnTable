import type { Track } from '@shared/types'
import { parseIsoDuration } from '../duration'

/** The few parts of a JSON:API document (https://jsonapi.org/format/) the app reads. Everything in it is untrusted. */
export interface Identifier {
  id?: unknown
  type?: unknown
  meta?: { addedAt?: unknown }
}

export interface Resource {
  id?: unknown
  type?: unknown
  attributes?: Record<string, unknown>
  relationships?: Record<string, { data?: unknown } | undefined>
}

export interface Document {
  data?: unknown
  included?: unknown
  links?: { next?: unknown; meta?: { nextCursor?: unknown } }
}

/** Ids are opaque to the API, but they end up in URLs and request bodies, so only accept plain ones. */
export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** Artwork at least this wide looks sharp in a list without fetching the largest image. */
const PREFERRED_ARTWORK_WIDTH = 300
const MAX_TEXT_LENGTH = 500

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.slice(0, MAX_TEXT_LENGTH) : undefined)

/** Resource identifiers in a to-many relationship's `data`. */
export const identifiers = (data: unknown): Identifier[] => (Array.isArray(data) ? data.filter(isRecord) : isRecord(data) ? [data] : [])

/** The resources a compound document carries along with its data, looked up by type and id. */
export class Included {
  private readonly byKey = new Map<string, Resource>()

  constructor(included: unknown) {
    if (!Array.isArray(included)) return
    for (const entry of included) {
      if (isRecord(entry) && typeof entry.id === 'string' && typeof entry.type === 'string') this.byKey.set(`${entry.type}:${entry.id}`, entry as Resource)
    }
  }

  get(type: string, id: unknown): Resource | undefined {
    return typeof id === 'string' ? this.byKey.get(`${type}:${id}`) : undefined
  }

  /** The included resources a relationship of `resource` points at. */
  related(resource: Resource | undefined, relationship: string, type: string): Resource[] {
    return identifiers(resource?.relationships?.[relationship]?.data).flatMap((identifier) => this.get(type, identifier.id) ?? [])
  }
}

/** The image to show: the smallest that is still sharp enough, else the largest. Only https addresses are kept. */
function pickArtwork(artwork: Resource | undefined): string | undefined {
  const files = Array.isArray(artwork?.attributes?.files) ? artwork.attributes.files : []
  const usable = files
    .flatMap((file) => {
      if (!isRecord(file) || typeof file.href !== 'string' || !file.href.startsWith('https://')) return []
      const width = isRecord(file.meta) && typeof file.meta.width === 'number' ? file.meta.width : 0
      return [{ href: file.href, width }]
    })
    .sort((a, b) => a.width - b.width)
  return (usable.find((file) => file.width >= PREFERRED_ARTWORK_WIDTH) ?? usable.at(-1))?.href
}

/** Only links that really point at TIDAL's site are passed on to the UI. */
const tidalWebUrl = (url: unknown): string | undefined => (typeof url === 'string' && url.startsWith('https://tidal.com/') ? url : undefined)

/**
 * A track from the document, or undefined if there is not enough to show it. `addedAt` is when the user saved it,
 * when the identifier says so.
 */
export function toTrack(identifier: Identifier, included: Included): Track | undefined {
  const id = identifier.id
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return undefined
  const track = included.get('tracks', id)
  const title = text(track?.attributes?.title)
  if (!track || !title) return undefined

  const version = text(track.attributes?.version)
  const album = included.related(track, 'albums', 'albums')[0]
  const artwork = included.related(album, 'coverArt', 'artworks')[0]
  const link = Array.isArray(track.attributes?.externalLinks) ? track.attributes.externalLinks.map((entry) => (isRecord(entry) ? tidalWebUrl(entry.href) : undefined)).find(Boolean) : undefined
  const availability = track.attributes?.availability
  const streamable = !Array.isArray(availability) || availability.includes('STREAM')
  const addedAt = identifier.meta?.addedAt

  return {
    id,
    providerId: 'tidal',
    title: version ? `${title} (${version})` : title,
    artists: included.related(track, 'artists', 'artists').flatMap((artist) => text(artist.attributes?.name) ?? []),
    album: text(album?.attributes?.title),
    durationMs: parseIsoDuration(typeof track.attributes?.duration === 'string' ? track.attributes.duration : undefined),
    artworkUrl: pickArtwork(artwork),
    url: link ?? `https://tidal.com/browse/track/${id}`,
    savedAt: typeof addedAt === 'string' ? addedAt : undefined,
    ...(streamable ? {} : { playable: false })
  }
}

/** The cursor for the next page, from the document's links, or undefined on the last page. */
export function nextCursorOf(document: Document): string | undefined {
  const given = document.links?.meta?.nextCursor
  if (typeof given === 'string' && given) return given
  const next = document.links?.next
  if (typeof next !== 'string' || !next) return undefined
  try {
    // `next` may be a path with a query; a base is only needed to parse it.
    return new URL(next, 'https://openapi.tidal.com').searchParams.get('page[cursor]') ?? undefined
  } catch {
    return undefined
  }
}
