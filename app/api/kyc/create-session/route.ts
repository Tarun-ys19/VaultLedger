import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { prisma } from '@/lib/prisma'
import { getOrProvisionUser } from '@/lib/provisioning'
import { stripe } from '@/lib/stripe'
import { serverError } from '@/lib/api-utils'

export async function POST() {
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

    // Check if already verified
    if (dbUser.kycStatus === 'VERIFIED') {
      return NextResponse.json(
        { error: 'User is already verified' },
        { status: 400 }
      )
    }

    // Support simulated KYC verification in environments where Stripe is not yet configured
    if (
      !process.env.STRIPE_SECRET_KEY ||
      process.env.STRIPE_SECRET_KEY.includes('placeholder')
    ) {
      await prisma.user.update({
        where: { id: dbUser.id },
        data: {
          kycStatus: 'VERIFIED',
          kycProviderId: 'sim_kyc_' + Date.now(),
        },
      })
      return NextResponse.json({
        clientSecret: 'simulated',
        sessionId: 'simulated',
        url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/kyc/success`,
      })
    }

    // Create Stripe Identity VerificationSession
    const verificationSession = await stripe.identity.verificationSessions.create({
      type: 'document',
      options: {
        document: {
          allowed_types: ['driving_license', 'passport', 'id_card'],
          require_live_capture: true,
          require_matching_selfie: true,
        },
      },
      metadata: {
        userId: dbUser.id,
        supabaseId: user.id,
        email: user.email || '',
      },
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/kyc/pending`,
    })

    // Update user with verification session ID
    await prisma.user.update({
      where: { id: dbUser.id },
      data: {
        kycProviderId: verificationSession.id,
      },
    })

    return NextResponse.json({
      clientSecret: verificationSession.client_secret,
      sessionId: verificationSession.id,
      url: verificationSession.url,
    })
  } catch (error) {
    return serverError('kyc/create-session', error)
  }
}
