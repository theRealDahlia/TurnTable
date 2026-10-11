import { describe, expect, it } from 'vitest'
import { createCodeChallenge, generateCodeVerifier, generateState } from '../src/main/auth/pkce'

describe('pkce', () => {
  it('matches the RFC 7636 appendix B test vector', () => {
    expect(createCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    )
  })

  it('generates URL-safe verifiers of valid length, and never repeats', () => {
    const verifier = generateCodeVerifier()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
    expect(generateCodeVerifier()).not.toBe(verifier)
  })

  it('generates distinct URL-safe state values', () => {
    const state = generateState()
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(generateState()).not.toBe(state)
  })
})
