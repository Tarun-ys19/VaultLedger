import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { prisma } from '@/lib/prisma'
import { getOrProvisionUser } from '@/lib/provisioning'
import { stripe } from '@/lib/stripe'
import { serverError } from '@/lib/api-utils'

export async function GET() {
  try {
    // Get authenticated user
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Find or auto-provision user in database
    const { user: dbUser } = await getOrProvisionUser(user)

    // If user has a verification session ID and status is PENDING, check Stripe
    if (
      dbUser.kycProviderId &&
      !dbUser.kycProviderId.startsWith('sim_') &&
      !process.env.STRIPE_SECRET_KEY?.includes('placeholder') &&
      dbUser.kycStatus === 'PENDING'
    ) {
      try {
        const session = await stripe.identity.verificationSessions.retrieve(
          dbUser.kycProviderId
        )

        // Update status based on Stripe session status
        let newStatus: "PENDING" | "VERIFIED" | "REJECTED" | "REQUIRES_REVIEW" = dbUser.kycStatus

        if (session.status === 'verified') {
          newStatus = 'VERIFIED'
        } else if (session.status === 'requires_input') {
          newStatus = 'REQUIRES_REVIEW'
        } else if (session.status === 'canceled') {
          newStatus = 'REJECTED'
        }

        // Update database if status changed
        if (newStatus !== dbUser.kycStatus) {
          await prisma.user.update({
            where: { id: dbUser.id },
            data: { kycStatus: newStatus },
          })

          return NextResponse.json({
            kycStatus: newStatus,
            sessionStatus: session.status,
            lastError: session.last_error?.reason,
          })
        }
      } catch (error) {
        console.error('Error fetching verification session:', error)
      }
    }

    return NextResponse.json({
      kycStatus: dbUser.kycStatus,
      kycProviderId: dbUser.kycProviderId,
    })
  } catch (error) {
    return serverError('kyc/status', error)
  }
}
