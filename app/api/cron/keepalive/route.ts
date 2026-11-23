import { NextResponse } from 'next/server'
import { createHash, timingSafeEqual } from 'node:crypto'
import { prisma } from '@/lib/prisma'
import { serverError, unauthorized } from '@/lib/api-utils'

function isAuthorizedCronRequest(request: Request): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return false
  }

  const header = request.headers.get('authorization')
  if (!header?.startsWith('Bearer ')) {
    return false
  }

  return secureCompare(header.slice('Bearer '.length), expected)
}

function secureCompare(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a).digest()
  const digestB = createHash('sha256').update(b).digest()
  return timingSafeEqual(digestA, digestB)
}

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request)) {
    return unauthorized()
  }

  try {
    await prisma.$queryRaw`SELECT 1`
    await prisma.user.count()

    return NextResponse.json({ ok: true })
  } catch (error) {
    return serverError('cron/keepalive', error)
  }
}
