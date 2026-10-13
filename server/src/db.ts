import { Pool, PoolClient } from 'pg';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://mahmoudkamel@localhost:5432/warehouse',
  max: 10,
});

export async function query(text: string, params: any[] = []) {
  return pool.query(text, params);
}

/** Run fn inside a single DB transaction — used whenever several tables must change atomically. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Atomically increment a named sequence and return the new value. Call inside a transaction. */
export async function nextSequence(client: PoolClient, name: string): Promise<number> {
  const r = await client.query(
    `update sequences set value = value + 1 where name = $1 returning value`,
    [name]
  );
  return r.rows[0].value as number;
}

/**
 * Normalize a DB date value (Date object or string) to a YYYY-MM-DD string.
 * Uses local date parts: pg returns `date` columns as local-midnight Dates, and
 * toISOString() would shift the day for non-UTC timezones.
 */
export function isoDate(v: any): string {
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v).slice(0, 10);
}
