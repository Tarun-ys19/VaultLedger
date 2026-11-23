import { prisma } from './prisma'
import { createClient } from './supabase-server'
import type { User } from '@prisma/client'

export async function getAdminUser(): Promise<User | null> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const dbUser = await prisma.user.findUnique({
    where: { supabaseId: user.id },
  })

  if (!dbUser || !dbUser.isAdmin) return null

  return dbUser
}
