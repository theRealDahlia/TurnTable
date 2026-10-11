import { createHash, randomBytes } from 'node:crypto'

const base64Url = (data: Buffer): string => data.toString('base64url')

/** RFC 7636 code verifier: 43 URL-safe characters from 32 random bytes. */
export function generateCodeVerifier(): string {
  return base64Url(randomBytes(32))
}

/** RFC 7636 S256 code challenge. */
export function createCodeChallenge(verifier: string): string {
  return base64Url(createHash('sha256').update(verifier).digest())
}

/** Opaque anti-CSRF value echoed back by the authorization server. */
export function generateState(): string {
  return base64Url(randomBytes(16))
}
