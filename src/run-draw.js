import { ensureNextDraw, runDueDraw } from './draws.js';
import { pool } from './db.js';
try {
  await ensureNextDraw();
  const result = await runDueDraw(false);
  console.log(JSON.stringify(result,null,2));
} catch (e) {
  if (e.message === 'DRAW_NOT_DUE') console.log('Draw not due yet.');
  else { console.error(e.message || e); process.exitCode = 1; }
} finally { await pool.end(); }
