import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { stripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import Stripe from 'stripe'
import { claimWebhookEvent, releaseWebhookEvent } from '@/lib/webhook-events'

export async function POST(request: Request) {
  const body = await request.text()
  const headersList = await headers()
  const signature = headersList.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'No signature' }, { status: 400 })
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      (process.env.STRIPE_IDENTITY_WEBHOOK_SECRET ||
        process.env.STRIPE_WEBHOOK_SECRET)!
    )
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  const claimed = await claimWebhookEvent('stripe_identity', event.id, event.type)
  if (!claimed) {
    return NextResponse.json({ received: true, duplicate: true })
  }

  try {
    switch (event.type) {
      case 'identity.verification_session.verified': {
        const session = event.data.object as Stripe.Identity.VerificationSession
        await prisma.user.updateMany({
          where: { kycProviderId: session.id },
          data: { kycStatus: 'VERIFIED' },
        })
        break
      }

      case 'identity.verification_session.requires_input': {
        const session = event.data.object as Stripe.Identity.VerificationSession
        await prisma.user.updateMany({
          where: { kycProviderId: session.id },
          data: { kycStatus: 'REQUIRES_REVIEW' },
        })
        break
      }

      case 'identity.verification_session.canceled': {
        const session = event.data.object as Stripe.Identity.VerificationSession
        await prisma.user.updateMany({
          where: { kycProviderId: session.id },
          data: { kycStatus: 'REJECTED' },
        })
        break
      }

      case 'identity.verification_session.processing': {
        break
      }

      default:
        break
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    await releaseWebhookEvent('stripe_identity', event.id)
    console.error('[webhooks/stripe-identity]', error)
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    )
  }
}
