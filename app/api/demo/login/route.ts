import { NextRequest, NextResponse } from 'next/server'
import { randomBytes, randomUUID } from 'crypto'
import { createClient } from '@/lib/supabase-server'
import { createAdminClient, hasAdminCredentials } from '@/lib/supabase-admin'
import {
  DEMO_EMAIL_DOMAIN,
  DEMO_TTL_HOURS,
  cleanupExpiredDemoAccounts,
  createDemoCustomer,
} from '@/lib/demo'
import { serverError, tooManyRequests } from '@/lib/api-utils'
import { rateLimit } from '@/lib/rate-limit'

const DEMO_RATE_LIMIT = { limit: 5, windowMs: 10 * 60 * 1000 }

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return request.headers.get('x-real-ip') ?? 'unknown'
}

export async function POST(request: NextRequest) {
  try {
    if (!hasAdminCredentials()) {
      console.error(
        'Demo login requires SUPABASE_SERVICE_ROLE_KEY to create the user'
      )
      return NextResponse.json(
        { error: 'Demo mode is not configured on this deployment.' },
        { status: 503 }
      )
    }

    const limit = rateLimit(`demo:login:${clientIp(request)}`, DEMO_RATE_LIMIT)
    if (!limit.allowed) {
      return tooManyRequests(limit.retryAfterSeconds)
    }

    const admin = createAdminClient()

    try {
      const expired = await cleanupExpiredDemoAccounts()
      for (const supabaseId of expired) {
        await admin.auth.admin.deleteUser(supabaseId).catch(() => undefined)
      }
    } catch (cleanupError) {
      console.error('Demo cleanup failed:', cleanupError)
    }

    const email = `demo-${randomUUID()}@${DEMO_EMAIL_DOMAIN}`
    const password = randomBytes(24).toString('base64url')

    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: 'Alex Demo', demo: true },
      })

    if (createError || !created.user) {
      console.error('Demo user creation failed:', createError)
      return NextResponse.json(
        { error: 'Could not start a demo session. Please try again.' },
        { status: 502 }
      )
    }

    try {
      await createDemoCustomer({
        supabaseId: created.user.id,
        email,
        ttlHours: DEMO_TTL_HOURS,
      })
    } catch (seedError) {
      console.error('Demo customer seeding failed:', seedError)
      await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined)
      return NextResponse.json(
        { error: 'Could not provision demo data. Please try again.' },
        { status: 502 }
      )
    }

    const supabase = await createClient()
    const { data: sessionData, error: signInError } =
      await supabase.auth.signInWithPassword({
        email,
        password,
      })

    if (signInError || !sessionData.session) {
      console.error('Demo session sign-in failed:', signInError)
      await admin.auth.admin.deleteUser(created.user.id).catch(() => undefined)
      return NextResponse.json(
        { error: 'Could not establish session. Please try again.' },
        { status: 502 }
      )
    }

    return NextResponse.json({
      success: true,
      redirectTo: '/dashboard',
    })
  } catch (error) {
    return serverError('demo/login', error)
  }
}
