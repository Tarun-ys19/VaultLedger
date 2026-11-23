import { Prisma, type Account, type User } from '@prisma/client'
import type { User as SupabaseUser } from '@supabase/supabase-js'
import { prisma } from './prisma'
import { generateAccountNumber } from './plaid-utils'

const ROUTING_NUMBER = '021000021'
const ACCOUNT_NUMBER_ATTEMPTS = 5
const PROVISIONING_LOCK_NAMESPACE = BigInt(0x9e01)
const CUSTOMER_ACCOUNT_TYPES: Account['accountType'][] = ['CHECKING', 'SAVINGS']

export interface ProvisionedUser {
  user: User
  account: Account
  created: boolean
}

function provisioningLockKey(supabaseId: string): bigint {
  let hash = 0x811c9dc5
  for (let i = 0; i < supabaseId.length; i++) {
    hash ^= supabaseId.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (PROVISIONING_LOCK_NAMESPACE << BigInt(32)) | BigInt(hash >>> 0)
}

function splitName(fullName: unknown): {
  firstName: string | null
  lastName: string | null
} {
  if (typeof fullName !== 'string') return { firstName: null, lastName: null }

  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { firstName: null, lastName: null }

  return {
    firstName: parts[0],
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : null,
  }
}

function isUniqueViolation(error: unknown, field?: string) {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false
  }

  if (!field) return true

  const target = error.meta?.target
  if (Array.isArray(target)) return target.includes(field)
  return typeof target === 'string' && target.includes(field)
}

async function findProvisioned(
  supabaseId: string
): Promise<ProvisionedUser | null> {
  const user = await prisma.user.findUnique({
    where: { supabaseId },
    include: {
      accounts: {
        where: { accountType: { in: CUSTOMER_ACCOUNT_TYPES } },
        orderBy: { createdAt: 'asc' },
        take: 1,
      },
    },
  })

  if (!user?.accounts[0]) return null

  const { accounts, ...rest } = user
  return { user: rest, account: accounts[0], created: false }
}

export async function getOrProvisionUser(
  supabaseUser: SupabaseUser
): Promise<ProvisionedUser> {
  const existing = await findProvisioned(supabaseUser.id)
  if (existing) {
    return existing
  }
  return await provisionUser(supabaseUser)
}

export async function provisionUser(
  supabaseUser: SupabaseUser
): Promise<ProvisionedUser> {
  const email = supabaseUser.email

  if (!email) {
    throw new Error(
      `Cannot provision Supabase user ${supabaseUser.id}: no email address`
    )
  }

  const { firstName, lastName } = splitName(
    supabaseUser.user_metadata?.full_name ?? supabaseUser.user_metadata?.name
  )
  const lockKey = provisioningLockKey(supabaseUser.id)

  for (let attempt = 1; attempt <= ACCOUNT_NUMBER_ATTEMPTS; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${lockKey})`

        const user = await tx.user.upsert({
          where: { supabaseId: supabaseUser.id },
          update: { email },
          create: {
            supabaseId: supabaseUser.id,
            email,
            firstName,
            lastName,
          },
        })

        const existingAccount = await tx.account.findFirst({
          where: {
            userId: user.id,
            accountType: { in: CUSTOMER_ACCOUNT_TYPES },
          },
          orderBy: { createdAt: 'asc' },
        })

        if (existingAccount) {
          return { user, account: existingAccount, created: false }
        }

        const account = await tx.account.create({
          data: {
            userId: user.id,
            accountType: 'CHECKING',
            accountNumber: generateAccountNumber(),
            routingNumber: ROUTING_NUMBER,
            balance: 0,
            currency: 'USD',
            status: 'ACTIVE',
          },
        })

        return { user, account, created: true }
      })
    } catch (error) {
      if (
        isUniqueViolation(error, 'accountNumber') &&
        attempt < ACCOUNT_NUMBER_ATTEMPTS
      ) {
        continue
      }

      if (isUniqueViolation(error)) {
        const existing = await findProvisioned(supabaseUser.id)
        if (existing) return existing
      }

      throw error
    }
  }

  throw new Error(
    `Could not allocate a unique account number for user ${supabaseUser.id} after ${ACCOUNT_NUMBER_ATTEMPTS} attempts`
  )
}
