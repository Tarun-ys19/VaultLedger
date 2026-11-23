import { prisma } from '../lib/prisma'
import { ensureDemoContacts, seedDemoDataFor } from '../lib/demo'

/**
 * Seed a user's account with demo transaction history.
 *
 * Usage: pnpm tsx scripts/seed-transactions.ts <user-email>
 */
async function main() {
  const userEmail = process.argv[2]

  if (!userEmail) {
    console.error('Error: please provide a user email address')
    console.log('\nUsage: pnpm tsx scripts/seed-transactions.ts <user-email>')
    console.log('Example: pnpm tsx scripts/seed-transactions.ts you@example.com\n')
    process.exitCode = 1
    return
  }

  console.log(`Seeding transaction history for ${userEmail}`)

  const user = await prisma.user.findUnique({
    where: { email: userEmail },
    include: {
      accounts: {
        where: {
          status: 'ACTIVE',
          // Never target a SYSTEM house account.
          accountType: { in: ['CHECKING', 'SAVINGS'] },
        },
        orderBy: { createdAt: 'asc' },
        take: 1,
      },
    },
  })

  if (!user) {
    throw new Error(`No user found with email ${userEmail}`)
  }

  const account = user.accounts[0]
  if (!account) {
    throw new Error(`No active customer account found for ${userEmail}`)
  }

  console.log(`  account ${account.accountNumber}`)
  console.log(`  starting balance: $${account.balance.toFixed(2)}`)

  await ensureDemoContacts()

  const { created, skipped } = await seedDemoDataFor({
    userId: user.id,
    accountId: account.id,
  })

  if (skipped) {
    console.log(
      '\nThis account already has transactions, so nothing was posted.'
    )
    console.log(
      'Clear them first with: pnpm tsx scripts/clean-fake-transactions.ts ' +
        userEmail
    )
    return
  }

  const updated = await prisma.account.findUniqueOrThrow({
    where: { id: account.id },
  })

  console.log(`\n  posted ${created} transactions`)
  console.log(`  final balance: $${updated.balance.toFixed(2)}`)

  // Prove the postings balanced rather than asserting it in a comment.
  const entries = await prisma.ledgerEntry.findMany({
    where: { transaction: { userId: user.id } },
    select: { entryType: true, amount: true },
  })

  const debits = entries
    .filter((e) => e.entryType === 'DEBIT')
    .reduce((sum, e) => sum.add(e.amount), updated.balance.sub(updated.balance))
  const credits = entries
    .filter((e) => e.entryType === 'CREDIT')
    .reduce((sum, e) => sum.add(e.amount), updated.balance.sub(updated.balance))

  console.log(`  ledger debits:  $${debits.toFixed(2)}`)
  console.log(`  ledger credits: $${credits.toFixed(2)}`)

  if (!debits.equals(credits)) {
    throw new Error(
      `Ledger does not balance: debits ${debits.toFixed(4)} vs credits ${credits.toFixed(4)}`
    )
  }

  console.log('  debits equal credits\n')
  console.log('Seed complete')
}

main()
  .catch((error) => {
    console.error('Seed failed:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
