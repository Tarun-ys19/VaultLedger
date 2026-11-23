import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { prisma } from '@/lib/prisma'
import { getOrProvisionUser } from '@/lib/provisioning'
import type { GetAccountsResponse } from '@/types/account'
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

    const userWithAccounts = await prisma.user.findUnique({
      where: { id: dbUser.id },
      include: {
        accounts: {
          where: {
            status: 'ACTIVE',
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
        externalAccounts: {
          orderBy: {
            createdAt: 'desc',
          },
        },
      },
    })

    if (!userWithAccounts) {
      return NextResponse.json({
        internalAccount: null,
        externalAccounts: [],
      })
    }

    // Get the first (primary) internal account
    const internalAccount = userWithAccounts.accounts[0] || null

    // Serialize accounts (convert Decimal to string)
    const serializedInternalAccount = internalAccount
      ? {
          ...internalAccount,
          balance: internalAccount.balance.toString(),
        }
      : null

    const serializedExternalAccounts = userWithAccounts.externalAccounts.map((account) => ({
      ...account,
      availableBalance: account.availableBalance?.toString() || null,
      currentBalance: account.currentBalance?.toString() || null,
      // Don't expose access token to client
      plaidAccessToken: undefined,
    }))

    const response: GetAccountsResponse = {
      internalAccount: serializedInternalAccount,
      externalAccounts: serializedExternalAccounts,
    }

    return NextResponse.json(response)
  } catch (error) {
    return serverError('accounts', error)
  }
}
