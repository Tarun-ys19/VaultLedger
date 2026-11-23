import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { prisma } from '@/lib/prisma'
import { getOrProvisionUser } from '@/lib/provisioning'
import { serverError } from '@/lib/api-utils'

export async function GET() {
  try {
    const supabase = await createClient()

    // Get authenticated user
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user from database, or auto-provision
    const { user: dbUser } = await getOrProvisionUser(user)

    // Get all cards for user
    const cards = await prisma.card.findMany({
      where: { userId: dbUser.id },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({
      success: true,
      cards: cards.map((card) => ({
        id: card.id,
        last4: card.last4,
        brand: card.brand,
        expiryMonth: card.expiryMonth,
        expiryYear: card.expiryYear,
        status: card.status,
        spendingLimit: card.spendingLimit,
        monthlyLimit: card.monthlyLimit,
        nickname: card.nickname,
        createdAt: card.createdAt,
      })),
    })
  } catch (error) {
    return serverError('cards/list', error)
  }
}
