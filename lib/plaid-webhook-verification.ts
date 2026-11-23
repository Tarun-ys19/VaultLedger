import { createHash, timingSafeEqual } from 'crypto'
import { decodeProtectedHeader, importJWK, jwtVerify, type JWK } from 'jose'
import { plaidClient } from './plaid'

const FIVE_MINUTES_MS = 5 * 60 * 1000
const keyCache = new Map<string, JWK>()

export type PlaidVerificationResult =
  | { verified: true }
  | { verified: false; reason: string }

async function getVerificationKey(kid: string): Promise<JWK | null> {
  const cached = keyCache.get(kid)
  if (cached) return cached

  try {
    const response = await plaidClient.webhookVerificationKeyGet({ key_id: kid })
    const key = response.data.key

    if (key.expired_at !== null && key.expired_at !== undefined) {
      return null
    }

    const jwk: JWK = {
      alg: key.alg,
      crv: key.crv,
      kid: key.kid,
      kty: key.kty,
      use: key.use,
      x: key.x,
      y: key.y,
    }

    keyCache.set(kid, jwk)
    return jwk
  } catch (error) {
    console.error('Failed to fetch Plaid webhook verification key:', error)
    return null
  }
}

function hashesMatch(expectedHex: string, actualHex: string): boolean {
  const expected = Buffer.from(expectedHex, 'hex')
  const actual = Buffer.from(actualHex, 'hex')
  if (expected.length !== actual.length || expected.length === 0) {
    return false
  }
  return timingSafeEqual(expected, actual)
}

export async function verifyPlaidWebhook(
  token: string | null,
  rawBody: string
): Promise<PlaidVerificationResult> {
  if (!token) {
    return { verified: false, reason: 'Missing Plaid-Verification header' }
  }

  let kid: string | undefined
  let alg: string | undefined
  try {
    const header = decodeProtectedHeader(token)
    kid = header.kid
    alg = header.alg
  } catch {
    return { verified: false, reason: 'Malformed verification token' }
  }

  if (alg !== 'ES256') {
    return { verified: false, reason: `Unexpected algorithm: ${alg}` }
  }

  if (!kid) {
    return { verified: false, reason: 'Verification token has no key ID' }
  }

  const jwk = await getVerificationKey(kid)
  if (!jwk) {
    return { verified: false, reason: 'Unknown or expired verification key' }
  }

  let payload
  try {
    const key = await importJWK(jwk, 'ES256')
    const result = await jwtVerify(token, key, { algorithms: ['ES256'] })
    payload = result.payload
  } catch {
    return { verified: false, reason: 'Signature verification failed' }
  }

  const issuedAtMs = typeof payload.iat === 'number' ? payload.iat * 1000 : 0
  if (!issuedAtMs || Date.now() - issuedAtMs > FIVE_MINUTES_MS) {
    return { verified: false, reason: 'Verification token is stale' }
  }

  const claimedHash = payload.request_body_sha256
  if (typeof claimedHash !== 'string') {
    return { verified: false, reason: 'Verification token has no body hash' }
  }

  const actualHash = createHash('sha256').update(rawBody, 'utf8').digest('hex')
  if (!hashesMatch(claimedHash, actualHash)) {
    return { verified: false, reason: 'Body hash mismatch' }
  }

  return { verified: true }
}

export function plaidEventId(rawBody: string, parsed: unknown): string {
  if (parsed && typeof parsed === 'object') {
    const body = parsed as Record<string, unknown>
    const event = body.transfer_event as Record<string, unknown> | undefined
    if (event && event.event_id !== undefined) {
      return `transfer_event:${String(event.event_id)}`
    }
  }
  return `body:${createHash('sha256').update(rawBody, 'utf8').digest('hex')}`
}
