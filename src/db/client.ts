/**
 * Database connection.
 *
 * Two decisions worth knowing about.
 *
 * **`pg` over the HTTP driver.** Security spec §8 requires webhook handlers to run inside
 * a transaction so partial application is impossible. Neon's HTTP driver cannot hold an
 * interactive transaction; a TCP pool can. Neon is still the host — this connects to its
 * pooler endpoint.
 *
 * **`rows()` exists on purpose.** With the node-postgres driver, `db.execute()` resolves to
 * a pg `Result` object, NOT an array, so `const [x] = await db.execute(...)` throws
 * "TypeError: result is not iterable". The HTTP driver *does* return an array, so code
 * written against one driver breaks silently on the other. We hit exactly this in the CRM.
 * Read raw queries through `rows()` and the shape is correct on either driver.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import type { SQL } from 'drizzle-orm';
import { Pool } from 'pg';
import * as schema from './schema';

export class DatabaseNotConfiguredError extends Error {
  readonly code = 'DATABASE_NOT_CONFIGURED';
  constructor() {
    super('DATABASE_URL is not set. Routes that need the database return 503 until it is.');
    this.name = 'DatabaseNotConfiguredError';
  }
}

let pool: Pool | null = null;
let instance: ReturnType<typeof drizzle<typeof schema>> | null = null;

/** True when a database is configured. The app boots and serves the catalog without one. */
export function isDatabaseConfigured(): boolean {
  return !!process.env.DATABASE_URL;
}

export function getDb() {
  if (!process.env.DATABASE_URL) throw new DatabaseNotConfiguredError();
  if (!instance) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    // A pool error with no listener crashes the process. A dropped idle connection is
    // normal against a serverless Postgres and must not take the storefront down.
    pool.on('error', (err) => {
      console.error('[db] pool error:', err.message);
    });
    instance = drizzle(pool, { schema });
  }
  return instance;
}

/** Rows from a raw SQL query, as an array, on either driver. See the note above. */
export async function rows<T = Record<string, unknown>>(query: SQL): Promise<T[]> {
  const res = (await getDb().execute(query)) as unknown;
  if (Array.isArray(res)) return res as T[];
  const maybe = res as { rows?: unknown };
  return Array.isArray(maybe.rows) ? (maybe.rows as T[]) : [];
}

/** Closes the pool. Tests need this; the server does not. */
export async function closeDb(): Promise<void> {
  if (pool) { await pool.end(); pool = null; instance = null; }
}
