import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase-server"
import { prisma } from "@/lib/prisma"
import { getOrProvisionUser } from "@/lib/provisioning"
import { AccountDetailsClient, type MonthlyStats } from "./account-details-client"

const EMPTY_MONTHLY_STATS: MonthlyStats = {
  transactionCount: 0,
  moneyIn: "0",
  moneyOut: "0",
}

export default async function AccountPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect("/login")
  }

  // Fetch user's internal account
  let account = null
  let monthlyStats: MonthlyStats = EMPTY_MONTHLY_STATS

  try {
    const { user: dbUser, account: primaryAccount } = await getOrProvisionUser(user)

    if (primaryAccount) {
      account = {
        ...primaryAccount,
        userId: dbUser.id,
        accountType: primaryAccount.accountType as "CHECKING" | "SAVINGS",
        balance: primaryAccount.balance.toString(),
      }

      monthlyStats = await getMonthlyStats(primaryAccount.id)
    }
  } catch (error) {
    console.error("Error fetching account:", error)
  }

  return (
    <AccountDetailsClient
      account={account}
      userEmail={user.email || ""}
      monthlyStats={monthlyStats}
    />
  )
}

async function getMonthlyStats(accountId: string): Promise<MonthlyStats> {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  const createdAt = { gte: monthStart, lt: nextMonthStart }

  const [transactionCount, moneyIn, moneyOut] = await Promise.all([
    prisma.transaction.count({
      where: {
        status: "COMPLETED",
        createdAt,
        OR: [{ fromAccountId: accountId }, { toAccountId: accountId }],
      },
    }),
    prisma.transaction.aggregate({
      _sum: { amount: true },
      where: { status: "COMPLETED", createdAt, toAccountId: accountId },
    }),
    prisma.transaction.aggregate({
      _sum: { amount: true },
      where: { status: "COMPLETED", createdAt, fromAccountId: accountId },
    }),
  ])

  return {
    transactionCount,
    moneyIn: moneyIn._sum.amount?.toString() ?? "0",
    moneyOut: moneyOut._sum.amount?.toString() ?? "0",
  }
}
