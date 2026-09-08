import { query, pool } from './db.js';
try { await query('SELECT 1'); console.log('OK'); } catch(e) { console.error(e.message); process.exitCode=1; } finally { await pool.end(); }
