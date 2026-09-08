import { config } from './config.js';
import { query, withTx } from './db.js';

function berlinParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).formatToParts(date);
  return Object.fromEntries(parts.filter(p=>p.type!=='literal').map(p=>[p.type, Number(p.value)]));
}
function zonedDate(year, month, day, hour, minute) {
  // Europe/Berlin DST-safe conversion by iterating around the target UTC timestamp.
  let d = new Date(Date.UTC(year, month-1, day, hour, minute));
  for (let i=0;i<4;i++) {
    const p=berlinParts(d);
    const diffMinutes=((p.year-year)*525600)+((p.month-month)*44640)+((p.day-day)*1440)+(p.hour-hour)*60+(p.minute-minute);
    d = new Date(d.getTime() - diffMinutes*60000);
  }
  return d;
}
export function nextScheduledDraw(from = new Date()) {
  const p = berlinParts(from);
  const base = new Date(Date.UTC(p.year,p.month-1,p.day));
  const day = new Date(base).getUTCDay(); // 0 Sun ... 6 Sat
  for (let add=0; add<8; add++) {
    const candidateDay = new Date(base); candidateDay.setUTCDate(candidateDay.getUTCDate()+add);
    const dow = candidateDay.getUTCDay();
    if (dow!==1 && dow!==4) continue;
    const draw = zonedDate(candidateDay.getUTCFullYear(), candidateDay.getUTCMonth()+1, candidateDay.getUTCDate(), config.drawHour, config.drawMinute);
    if (draw > from) {
      const cutoff = zonedDate(candidateDay.getUTCFullYear(), candidateDay.getUTCMonth()+1, candidateDay.getUTCDate(), config.cutoffHour, config.cutoffMinute);
      return { drawAt:draw, cutoffAt:cutoff };
    }
  }
}
export async function ensureNextDraw() {
  const existing = await query(`SELECT * FROM draws WHERE status='open' ORDER BY draw_at ASC LIMIT 1`);
  if (existing.rows[0]) return existing.rows[0];
  const s = await query(`SELECT value FROM app_settings WHERE key='next_jackpot'`);
  const jackpot = Number(s.rows[0]?.value ?? config.startingJackpot);
  const n = nextScheduledDraw();
  const r = await query(`INSERT INTO draws(draw_at,cutoff_at,jackpot,status) VALUES($1,$2,$3,'open') ON CONFLICT(draw_at) DO UPDATE SET jackpot=EXCLUDED.jackpot RETURNING *`, [n.drawAt,n.cutoffAt,jackpot]);
  return r.rows[0];
}
function randomNumbers() { const a=[]; while(a.length<6){const n=Math.floor(Math.random()*35)+1;if(!a.includes(n))a.push(n)} return a.sort((a,b)=>a-b); }
function fmtMoney(n){return Math.round(Number(n)*100)/100;}

export async function runDueDraw(force=false) {
  return withTx(async client => {
    const open = await client.query(`SELECT * FROM draws WHERE status='open' ORDER BY draw_at ASC LIMIT 1 FOR UPDATE`);
    if (!open.rows[0]) throw new Error('NO_OPEN_DRAW');
    const draw = open.rows[0];
    if (!force && new Date() < new Date(draw.cutoff_at)) throw new Error('DRAW_NOT_DUE');
    const nums = randomNumbers();
    const winnerCounts = {3:0,4:0,5:0,6:0};
    const tips = await client.query(`SELECT * FROM tips WHERE draw_id=$1`, [draw.id]);
    const results=[];
    const winSet = new Set(nums);
    for (const t of tips.rows) {
      const tn=[t.number_1,t.number_2,t.number_3,t.number_4,t.number_5,t.number_6];
      const matches=tn.reduce((n,x)=>n+(winSet.has(x)?1:0),0);
      results.push([t.id,matches]); if(matches>=3) winnerCounts[matches]++;
    }
    const jackpot=Number(draw.jackpot);
    const prizes={};
    let allocated=0;
    for(const m of [6,5,4,3]){
      const pool=fmtMoney(jackpot*config.prizeShares[m]);
      const count=winnerCounts[m];
      const per=count?fmtMoney(pool/count):0;
      prizes[m]={pool,count,per}; if(count) allocated+=pool;
      await client.query(`INSERT INTO prizes(draw_id,matches,winner_count,prize_pool,payout_per_winner) VALUES($1,$2,$3,$4,$5) ON CONFLICT(draw_id,matches) DO UPDATE SET winner_count=EXCLUDED.winner_count,prize_pool=EXCLUDED.prize_pool,payout_per_winner=EXCLUDED.payout_per_winner`, [draw.id,m,count,pool,per]);
    }
    for(const [tipId,matches] of results){const prize=matches>=3?prizes[matches].per:0; await client.query(`INSERT INTO tip_results(tip_id,matches,prize) VALUES($1,$2,$3) ON CONFLICT(tip_id) DO UPDATE SET matches=EXCLUDED.matches,prize=EXCLUDED.prize`, [tipId,matches,prize]);}
    const unclaimed=fmtMoney(jackpot-allocated);
    await client.query(`UPDATE draws SET status='completed',number_1=$2,number_2=$3,number_3=$4,number_4=$5,number_5=$6,number_6=$7,completed_at=now() WHERE id=$1`, [draw.id,...nums]);
    await client.query(`INSERT INTO app_settings(key,value) VALUES('next_jackpot',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [String(unclaimed)]);
    return { drawId:draw.id, drawAt:draw.draw_at, numbers:nums, jackpot, winnerCounts, prizes, nextJackpot:unclaimed };
  });
}
