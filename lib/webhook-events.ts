import { prisma } from './prisma'

export type WebhookProvider = 'stripe_issuing' | 'stripe_identity' | 'plaid'

export async function claimWebhookEvent(
  provider: WebhookProvider,
  eventId: string,
  eventType?: string
): Promise<boolean> {
  const result = await prisma.processedWebhookEvent.createMany({
    data: [{ provider, eventId, eventType }],
    skipDuplicates: true,
  })

  return result.count === 1
}

export async function releaseWebhookEvent(
  provider: WebhookProvider,
  eventId: string
): Promise<void> {
  await prisma.processedWebhookEvent
    .delete({ where: { provider_eventId: { provider, eventId } } })
    .catch(() => undefined)
}
