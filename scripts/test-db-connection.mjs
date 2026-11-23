import { PrismaClient } from '@prisma/client'

async function testConnection() {
  console.log('🔍 Testing database connection...\n')

  const prisma = new PrismaClient()

  try {
    // Try to connect
    await prisma.$connect()
    console.log('✅ Database connection successful!\n')

    // Try a simple query
    const userCount = await prisma.user.count()
    console.log(`📊 Database has ${userCount} users\n`)

    console.log('✅ Everything is working correctly!')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    console.error('❌ Database connection failed!\n')
    console.error('Error:', message, '\n')

    if (message.includes('Authentication failed')) {
      console.log('💡 Fix: Your database credentials are incorrect.')
      console.log('   Check your DATABASE_URL in .env file\n')
    } else if (message.includes("Can't reach database")) {
      console.log('💡 Fix: Database server is not running or unreachable.')
      console.log('   - For local PostgreSQL: Start the PostgreSQL service')
      console.log('   - For Supabase: Check your internet connection\n')
    } else {
      console.log('💡 Check DATABASE_URL in your .env file against the')
      console.log('   connection string in the Supabase dashboard\n')
    }
  } finally {
    await prisma.$disconnect()
  }
}

testConnection()
