/** An ISO 8601 duration such as `PT3M45S` or `PT1H2M3S`, in milliseconds; 0 for anything else (live streams are `P0D`). */
export function parseIsoDuration(value: string | undefined): number {
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value ?? '')
  if (!match) return 0
  const [days, hours, minutes, seconds] = match.slice(1).map((part) => Number(part ?? 0))
  return Math.round((((days ?? 0) * 24 + (hours ?? 0)) * 3600 + (minutes ?? 0) * 60 + (seconds ?? 0)) * 1000)
}
