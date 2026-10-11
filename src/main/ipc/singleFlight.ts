/**
 * Lets callers that ask for the same thing while it is already being fetched share that one answer.
 * Nothing is remembered once the request settles, so later calls always fetch fresh data.
 */
export function shareInFlight<T>(inFlight: Map<string, Promise<T>>, key: string, start: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key)
  if (existing) return existing

  // `Promise.resolve().then` turns a synchronous throw in `start` into a rejection, so cleanup always runs.
  const promise = Promise.resolve()
    .then(start)
    .finally(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key)
    })
  inFlight.set(key, promise)
  return promise
}
