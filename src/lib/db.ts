import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

let client: PrismaClient

try {
  client =
    globalForPrisma.prisma ??
    new PrismaClient({
      log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
    })

  if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = client
} catch (err) {
  console.error(
    'Failed to initialize PrismaClient. Run: npx prisma db push && npx prisma generate',
    err
  )
  // Fallback: a proxy that throws a helpful error when any property is accessed.
  // This prevents the entire app from crashing on import — individual API routes
  // will return a clear error message instead of a 404.
  client = new Proxy({} as PrismaClient, {
    get() {
      throw new Error(
        'PrismaClient not initialized. Run: npx prisma db push && npx prisma generate'
      )
    },
  })
}

export const db = client
