import fs from 'node:fs/promises';
import { pool } from './db.js';

export async function migrateDatabase() {
  const sql = await fs.readFile(new URL('../sql/001_init.sql', import.meta.url), 'utf8');
  await pool.query(sql);
  console.log('Database migration complete.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    await migrateDatabase();
  } finally {
    await pool.end();
  }
}
