import Stripe from 'stripe'

let client: Stripe | null = null

function getStripe(): Stripe {
  if (client) return client

  const apiKey = process.env.STRIPE_SECRET_KEY
  if (!apiKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured.')
  }

  client = new Stripe(apiKey, {
    apiVersion: '2025-10-29.clover',
    typescript: true,
  })

  return client
}

export const stripe = new Proxy({} as Stripe, {
  get(_target, property) {
    const instance = getStripe()
    const value = instance[property as keyof Stripe]
    return typeof value === 'function' ? value.bind(instance) : value
  },
})
