/**
 * Server errors a service may answer with for a moment (an overloaded or restarting server) that are worth asking
 * again for, after a pause. A refusal (4xx) or a rate limit (429) is never one of them.
 */
const TRANSIENT_STATUSES = new Set([500, 502, 503, 504])

/** How long to wait before each further try of a read that met a transient server error; one entry per try. */
export const SERVER_ERROR_RETRY_DELAYS_MS = [2_000, 5_000] as const

/** True when a read that failed with `status` may be tried again after the `attempt`th delay (0-based). */
export const shouldRetryServerError = (method: string | undefined, status: number, attempt: number): boolean =>
  (method === undefined || method === 'GET') && TRANSIENT_STATUSES.has(status) && attempt < SERVER_ERROR_RETRY_DELAYS_MS.length
