import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

let client: PrismaClient

// ---------------------------------------------------------------------------
// SQLite connection tuning for high-concurrency reads:
//   - connection_limit: size of the internal connection pool. SQLite serializes
//     writes anyway, but WAL mode (enabled once on the db file — persistent)
//     lets readers proceed without blocking the writer, so a modest pool gives
//     far better read parallelism than the default single-connection setup.
//   - pool_timeout / socket_timeout: fail fast instead of hanging when the pool
//     or a query is stuck.
// The params are appended safely whether DATABASE_URL already has query args.
// ---------------------------------------------------------------------------
function tunedDatabaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL
  if (!url) return undefined
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}connection_limit=10&pool_timeout=10&socket_timeout=30`
}

try {
  client =
    globalForPrisma.prisma ??
    new PrismaClient({
      datasources: tunedDatabaseUrl() ? { db: { url: tunedDatabaseUrl()! } } : undefined,
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
