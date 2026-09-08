import fs from 'node:fs/promises';
import { pool } from './db.js';
const sql = await fs.readFile(new URL('../sql/001_init.sql', import.meta.url), 'utf8');
await pool.query(sql);
console.log('Database migration complete.');
await pool.end();
