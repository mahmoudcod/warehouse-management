import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { pool } from './db';

async function main() {
  const dir = path.join(__dirname, '..', 'migrations');
  await pool.query(
    `create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now())`
  );
  const applied = new Set(
    (await pool.query(`select name from schema_migrations`)).rows.map((r) => r.name)
  );
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(`insert into schema_migrations (name) values ($1)`, [file]);
      await client.query('COMMIT');
      console.log(`✔ applied ${file}`);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`✖ failed ${file}`, e);
      process.exit(1);
    } finally {
      client.release();
    }
  }
  await pool.end();
  console.log('Migrations complete.');
}

main();
