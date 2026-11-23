import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { stripe } from '@/lib/stripe-issuing-utils'
import { prisma } from '@/lib/prisma'
import Stripe from 'stripe'
import { Decimal } from '@prisma/client/runtime/library'
import {
  InsufficientFundsError,
  getSystemAccount,
  postDoubleEntry,
} from '@/lib/ledger'
import { claimWebhookEvent, releaseWebhookEvent } from '@/lib/webhook-events'

const STRIPE_WEBHOOK_SECRET =
  process.env.STRIPE_ISSUING_WEBHOOK_SECRET || process.env.STRIPE_WEBHOOK_SECRET

export async function POST(request: NextRequest) {
  try {
    const body = await request.text()
    const headersList = await headers()
    const signature = headersList.get('stripe-signature')

    if (!signature) {
      return NextResponse.json(
        { error: 'Missing stripe-signature header' },
        { status: 400 }
      )
    }

    if (!STRIPE_WEBHOOK_SECRET) {
      return NextResponse.json(
        { error: 'Webhook secret not configured' },
        { status: 500 }
      )
    }

    let event: Stripe.Event
    try {
      event = stripe.webhooks.constructEvent(body, signature, STRIPE_WEBHOOK_SECRET)
    } catch (err) {
      console.error('Webhook signature verification failed:', err)
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 400 }
      )
    }

    const claimed = await claimWebhookEvent(
      'stripe_issuing',
      event.id,
      event.type
    )
    if (!claimed) {
      return NextResponse.json({ received: true, duplicate: true })
    }

    try {
      switch (event.type) {
        case 'issuing_card.created':
          await handleCardCreated(event.data.object as Stripe.Issuing.Card)
          break

        case 'issuing_card.updated':
          await handleCardUpdated(event.data.object as Stripe.Issuing.Card)
          break

        case 'issuing_authorization.created':
          await handleAuthorizationCreated(
            event.data.object as Stripe.Issuing.Authorization
          )
          break

        case 'issuing_authorization.updated':
          await handleAuthorizationUpdated(
            event.data.object as Stripe.Issuing.Authorization
          )
          break

        case 'issuing_transaction.created':
          await handleTransactionCreated(
            event.data.object as Stripe.Issuing.Transaction
          )
          break

        case 'issuing_transaction.updated':
          await handleTransactionUpdated(
            event.data.object as Stripe.Issuing.Transaction
          )
          break

        default:
          break
      }
    } catch (handlerError) {
      await releaseWebhookEvent('stripe_issuing', event.id)
      throw handlerError
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json(
      { error: 'Webhook handler failed' },
      { status: 500 }
    )
  }
}

async function handleCardCreated(card: Stripe.Issuing.Card) {
  console.log(`Card created: ${card.id}`)
}

async function handleCardUpdated(card: Stripe.Issuing.Card) {
  const dbCard = await prisma.card.findUnique({
    where: { stripeCardId: card.id },
  })

  if (!dbCard) {
    console.error(`Card not found in database: ${card.id}`)
    return
  }

  let status: 'ACTIVE' | 'FROZEN' | 'CANCELLED'
  if (card.status === 'active') {
    status = 'ACTIVE'
  } else if (card.status === 'inactive') {
    status = 'FROZEN'
  } else {
    status = 'CANCELLED'
  }

  await prisma.card.update({
    where: { stripeCardId: card.id },
    data: { status },
  })
}

async function handleAuthorizationCreated(
  authorization: Stripe.Issuing.Authorization
) {
  const card = await prisma.card.findUnique({
    where: { stripeCardId: authorization.card.id },
    include: { user: true },
  })

  if (!card) {
    console.error(`Card not found: ${authorization.card.id}`)
    return
  }
}

async function handleAuthorizationUpdated(
  _authorization: Stripe.Issuing.Authorization
) {}

async function handleTransactionCreated(transaction: Stripe.Issuing.Transaction) {
  const cardId = stripeCardId(transaction.card)

  const card = await prisma.card.findUnique({
    where: { stripeCardId: cardId },
    select: { userId: true, last4: true, user: { select: { email: true } } },
  })

  if (!card) {
    console.error(`Card not found: ${cardId}`)
    return
  }

  const internalAccount = await prisma.account.findFirst({
    where: {
      userId: card.userId,
      accountType: 'CHECKING',
      status: 'ACTIVE',
    },
  })

  if (!internalAccount) {
    console.error(`No active account found for user ${card.userId}`)
    return
  }

  const amount = new Decimal(transaction.amount).abs().div(100)
  const isRefund = transaction.amount > 0

  if (amount.lte(0)) {
    return
  }

  try {
    await prisma.$transaction(async (tx) => {
      const settlement = await getSystemAccount(tx, 'CARD_SETTLEMENT')

      const dbTransaction = await tx.transaction.create({
        data: {
          userId: card.userId,
          fromAccountId: isRefund ? null : internalAccount.id,
          toAccountId: isRefund ? internalAccount.id : null,
          amount,
          currency: transaction.currency.toUpperCase(),
          type: isRefund ? 'CARD_REFUND' : 'CARD_PURCHASE',
          status: 'COMPLETED',
          description: `${transaction.merchant_data?.name || 'Card Transaction'} - Card ••••${card.last4}`,
          idempotencyKey: `stripe_issuing_txn_${transaction.id}`,
          externalId: transaction.id,
          metadata: {
            stripeTransactionId: transaction.id,
            merchantName: transaction.merchant_data?.name,
            merchantCategory: transaction.merchant_data?.category,
            cardLast4: card.last4,
          },
        },
      })

      await postDoubleEntry(tx, {
        transactionId: dbTransaction.id,
        debitAccountId: isRefund ? settlement.id : internalAccount.id,
        creditAccountId: isRefund ? internalAccount.id : settlement.id,
        amount,
        debitDescription: isRefund
          ? 'Card Refund - settlement'
          : 'Card Purchase',
        creditDescription: isRefund
          ? 'Card Refund'
          : 'Card Purchase - settlement',
      })
    })
  } catch (error) {
    if (error instanceof InsufficientFundsError) {
      console.error(
        `Card transaction ${transaction.id} exceeds available balance for user ${card.userId}`
      )
      return
    }
    throw error
  }
}

function stripeCardId(card: string | Stripe.Issuing.Card): string {
  return typeof card === 'string' ? card : card.id
}

async function handleTransactionUpdated(_transaction: Stripe.Issuing.Transaction) {}
