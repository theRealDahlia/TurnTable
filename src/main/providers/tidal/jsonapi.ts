import type { Album, Track } from '@shared/types'
import { parseIsoDuration } from '../duration'

/** The few parts of a JSON:API document (https://jsonapi.org/format/) the app reads. Everything in it is untrusted. */
export interface Identifier {
  id?: unknown
  type?: unknown
  /** `addedAt` on a collection's items; `volumeNumber` and `trackNumber` on an album's. */
  meta?: { addedAt?: unknown; volumeNumber?: unknown; trackNumber?: unknown }
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

const firstLink = (links: unknown): string | undefined =>
  Array.isArray(links) ? links.map((entry) => (isRecord(entry) ? tidalWebUrl(entry.href) : undefined)).find(Boolean) : undefined

const position = (value: unknown): number | undefined => (typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined)

/** The id of a related resource, if it is a plain one. */
const plainId = (resource: Resource | undefined): string => (typeof resource?.id === 'string' && ID_PATTERN.test(resource.id) ? resource.id : '')

/** Names and ids of the artists a resource credits, kept in step; artists without a name are left out of both. */
function creditedArtists(resource: Resource | undefined, included: Included): { names: string[]; ids: string[] } {
  const named = included.related(resource, 'artists', 'artists').flatMap((artist) => {
    const name = text(artist.attributes?.name)
    return name ? [{ name, id: plainId(artist) }] : []
  })
  return { names: named.map((artist) => artist.name), ids: named.map((artist) => artist.id) }
}

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
  const albumId = plainId(album)
  const artwork = included.related(album, 'coverArt', 'artworks')[0]
  const link = firstLink(track.attributes?.externalLinks)
  const availability = track.attributes?.availability
  const streamable = !Array.isArray(availability) || availability.includes('STREAM')
  const addedAt = identifier.meta?.addedAt
  const artists = creditedArtists(track, included)

  return {
    id,
    providerId: 'tidal',
    title: version ? `${title} (${version})` : title,
    artists: artists.names,
    artistIds: artists.ids,
    album: text(album?.attributes?.title),
    ...(albumId ? { albumId } : {}),
    discNumber: position(identifier.meta?.volumeNumber),
    trackNumber: position(identifier.meta?.trackNumber),
    durationMs: parseIsoDuration(typeof track.attributes?.duration === 'string' ? track.attributes.duration : undefined),
    artworkUrl: pickArtwork(artwork),
    url: link ?? `https://tidal.com/browse/track/${id}`,
    savedAt: typeof addedAt === 'string' ? addedAt : undefined,
    ...(streamable ? {} : { playable: false })
  }
}

const ALBUM_KINDS: Record<string, Album['kind']> = { ALBUM: 'album', EP: 'ep', SINGLE: 'single' }
/** Release dates are kept only in the plain forms TIDAL uses, "2003-05-20" (or a shorter part of it). */
const DATE_PATTERN = /^\d{4}(-\d{2}){0,2}$/

/** An album from the document, or undefined if there is not enough to show it. */
export function toAlbum(identifier: Identifier, included: Included): Album | undefined {
  const id = identifier.id
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) return undefined
  const album = included.get('albums', id)
  const title = text(album?.attributes?.title)
  if (!album || !title) return undefined

  const releaseDate = album.attributes?.releaseDate
  const kind = album.attributes?.albumType
  const count = position(album.attributes?.numberOfItems)
  const artists = creditedArtists(album, included)
  return {
    id,
    providerId: 'tidal',
    title,
    artists: artists.names,
    artistIds: artists.ids,
    artworkUrl: pickArtwork(included.related(album, 'coverArt', 'artworks')[0]),
    releaseDate: typeof releaseDate === 'string' && DATE_PATTERN.test(releaseDate) ? releaseDate : undefined,
    kind: typeof kind === 'string' ? ALBUM_KINDS[kind] : undefined,
    ...(count ? { trackCount: count } : {}),
    url: firstLink(album.attributes?.externalLinks) ?? `https://tidal.com/browse/album/${id}`
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
