interface Window {
  count: number
  resetAt: number
}

const windows = new Map<string, Window>()

function sweep(now: number) {
  if (windows.size < 5000) return
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key)
  }
}

export interface RateLimitOptions {
  limit: number
  windowMs: number
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

export function rateLimit(
  key: string,
  { limit, windowMs }: RateLimitOptions
): RateLimitResult {
  const now = Date.now()
  sweep(now)

  const existing = windows.get(key)

  if (!existing || existing.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowMs })
    return {
      allowed: true,
      remaining: limit - 1,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    }
  }

  existing.count += 1
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((existing.resetAt - now) / 1000)
  )

  if (existing.count > limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds }
  }

  return {
    allowed: true,
    remaining: limit - existing.count,
    retryAfterSeconds,
  }
}

export const RATE_LIMITS = {
  transfer: { limit: 10, windowMs: 60_000 },
  recipientLookup: { limit: 20, windowMs: 60_000 },
  provisioning: { limit: 5, windowMs: 60_000 },
  read: { limit: 120, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitOptions>
