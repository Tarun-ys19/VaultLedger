import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase-server'
import { getOrProvisionUser } from '@/lib/provisioning'
import { TransfersClient } from './transfers-client'

export default async function TransfersPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  // Fetch user's internal account and KYC status
  let account = null
  let kycStatus: 'PENDING' | 'VERIFIED' | 'REJECTED' | 'REQUIRES_REVIEW' =
    'PENDING'

  try {
    const { user: dbUser, account: primaryAccount } = await getOrProvisionUser(user)

    if (dbUser) {
      kycStatus = dbUser.kycStatus

      if (primaryAccount) {
        account = {
          ...primaryAccount,
          balance: primaryAccount.balance.toString(),
        }
      }
    }
  } catch (error) {
    console.error('Error fetching account:', error)
  }

  return (
    <TransfersClient account={account} kycStatus={kycStatus} />
  )
}
