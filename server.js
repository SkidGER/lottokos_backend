import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import 'dotenv/config';
import { config } from './config.js';
import { migrateDatabase } from './migrate.js';
import { query } from './db.js';
import { hashPassword, verifyPassword, createSession, getSessionUser, deleteSession, setSessionCookie, clearSessionCookie } from './security.js';
import { ensureNextDraw, runDueDraw } from './draws.js';

const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 32 * 1024 });
await app.register(cookie);
await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: false });
await app.register(cors, {
  origin: (origin, cb) => {
    if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Origin not allowed'), false);
  },
  credentials: true,
  methods: ['GET','POST','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Accept','Authorization']
});
await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });

app.addHook('onRequest', async (request, reply) => {
  if (['POST','DELETE','PUT','PATCH'].includes(request.method)) {
    const origin = request.headers.origin;
    if (origin && !config.corsOrigins.includes(origin)) return reply.code(403).send({ message:'Origin not allowed.' });
  }
});
app.addHook('onSend', async (request, reply, payload) => {
  if (request.url.startsWith('/api/auth') || request.url.startsWith('/api/account')) {
    reply.header('Cache-Control','no-store');
  }
  return payload;
});

const emailSchema=z.string().trim().toLowerCase().email().max(254);
const passwordSchema=z.string().min(8).max(200);
const numbersSchema=z.array(z.number().int().min(1).max(35)).length(6).refine(a=>new Set(a).size===6,'Numbers must be unique.');
function publicUser(u){return {id:u.id,accountId:String(u.id),email:u.email,createdAt:u.created_at};}
async function requireUser(request, reply){const u=await getSessionUser(request);if(!u){reply.code(401).send({message:'Not signed in.'});return null}return u;}
function dateText(v){return new Intl.DateTimeFormat('en-GB',{timeZone:config.timezone,weekday:'long',day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(v));}

app.get('/health', async()=>({ok:true}));
app.get('/api/health', async()=>({ok:true}));

app.post('/api/auth/register', { config:{rateLimit:{max:10,timeWindow:'15 minutes'}} }, async (request, reply)=>{
  const parsed=z.object({email:emailSchema,password:passwordSchema}).safeParse(request.body);
  if(!parsed.success) return reply.code(400).send({message:'Please enter a valid email and a password of at least 8 characters.'});
  const {email,password}=parsed.data;
  const exists=await query('SELECT id FROM users WHERE email=$1',[email]);
  if(exists.rows[0]) return reply.code(409).send({message:'An account with this email already exists.'});
  const passwordHash=await hashPassword(password);
  const result=await query('INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id,email,created_at',[email,passwordHash]);
  const user=result.rows[0];
  const session=await createSession(user.id); setSessionCookie(reply,session.token,session.expires);
  return reply.code(201).send({user:publicUser(user)});
});

app.post('/api/auth/login', { config:{rateLimit:{max:10,timeWindow:'15 minutes'}} }, async (request, reply)=>{
  const parsed=z.object({email:emailSchema,password:z.string().max(200)}).safeParse(request.body);
  if(!parsed.success) return reply.code(400).send({message:'Invalid sign-in details.'});
  const {email,password}=parsed.data;
  const result=await query('SELECT id,email,password_hash,created_at FROM users WHERE email=$1',[email]);
  if(!result.rows[0] || !(await verifyPassword(result.rows[0].password_hash,password))) return reply.code(401).send({message:'Invalid email or password.'});
  await deleteSession(request);
  const session=await createSession(result.rows[0].id); setSessionCookie(reply,session.token,session.expires);
  return {user:publicUser(result.rows[0])};
});

app.post('/api/auth/logout', async (request, reply)=>{await deleteSession(request);clearSessionCookie(reply);return {ok:true};});
app.get('/api/auth/me', async(request)=>{const u=await getSessionUser(request);return {authenticated:Boolean(u),user:u?publicUser(u):null};});

app.get('/api/draw/next', async()=>{
  const d=await ensureNextDraw();
  return {drawId:d.id,drawAt:d.draw_at,cutoffAt:d.cutoff_at,status:new Date(d.cutoff_at)>new Date()?'open':'closed',jackpot:Number(d.jackpot)};
});

app.post('/api/tips', async(request, reply)=>{
  const user=await requireUser(request,reply); if(!user)return;
  const parsed=z.object({numbers:numbersSchema}).safeParse(request.body);
  if(!parsed.success)return reply.code(400).send({message:'Choose exactly 6 different numbers from 1 to 35.'});
  const draw=await ensureNextDraw();
  if(new Date()>=new Date(draw.cutoff_at))return reply.code(409).send({message:'Entries for this draw are closed.'});
  const nums=[...parsed.data.numbers].sort((a,b)=>a-b);
  try {
    const r=await query(`INSERT INTO tips(user_id,draw_id,number_1,number_2,number_3,number_4,number_5,number_6) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,draw_id,created_at`,[user.id,draw.id,...nums]);
    return reply.code(201).send({ok:true,tipId:r.rows[0].id,drawId:draw.id,numbers:nums});
  } catch(e){if(e.code==='23505')return reply.code(409).send({message:'You already entered this draw.'});throw e;}
});

app.get('/api/account', async(request, reply)=>{
  const user=await requireUser(request,reply); if(!user)return;
  const stats=await query(`SELECT COUNT(*)::int AS total_tips,COUNT(DISTINCT t.draw_id)::int AS draws_entered,COUNT(*) FILTER (WHERE COALESCE(tr.matches,0)>=3)::int AS wins,COALESCE(MAX(tr.matches),0)::int AS best_result FROM tips t LEFT JOIN tip_results tr ON tr.tip_id=t.id WHERE t.user_id=$1`,[user.id]);
  const entries=await query(`SELECT t.id,t.draw_id,d.draw_at,t.number_1,t.number_2,t.number_3,t.number_4,t.number_5,t.number_6,COALESCE(tr.matches,0) matches,COALESCE(tr.prize,0) prize FROM tips t JOIN draws d ON d.id=t.draw_id LEFT JOIN tip_results tr ON tr.tip_id=t.id WHERE t.user_id=$1 ORDER BY t.created_at DESC LIMIT 50`,[user.id]);
  return {user:publicUser(user),stats:{totalTips:stats.rows[0].total_tips,drawsEntered:stats.rows[0].draws_entered,wins:stats.rows[0].wins,bestResult:stats.rows[0].best_result},entries:entries.rows.map(x=>({tipId:x.id,drawId:x.draw_id,drawDate:dateText(x.draw_at),numbers:[x.number_1,x.number_2,x.number_3,x.number_4,x.number_5,x.number_6],matches:x.matches,won:x.matches>=3,result:x.matches>=3?`${x.matches} numbers`:'No win',prize:Number(x.prize)}))};
});

app.delete('/api/account', async(request, reply)=>{
  const user=await requireUser(request,reply);if(!user)return;
  await query('DELETE FROM users WHERE id=$1',[user.id]);clearSessionCookie(reply);return {ok:true};
});

app.get('/api/results', async()=>{
  const latest=await query(`SELECT * FROM draws WHERE status='completed' ORDER BY draw_at DESC LIMIT 1`);
  const previous=await query(`SELECT * FROM draws WHERE status='completed' ORDER BY draw_at DESC LIMIT 20 OFFSET 1`);
  if(!latest.rows[0]) return {latest:null,previous:[]};
  const d=latest.rows[0];
  const prizes=await query(`SELECT matches,winner_count,payout_per_winner,prize_pool FROM prizes WHERE draw_id=$1 ORDER BY matches DESC`,[d.id]);
  const totalWinners=prizes.rows.reduce((n,x)=>n+Number(x.winner_count),0);
  const next=await query(`SELECT value FROM app_settings WHERE key='next_jackpot'`);
  const prizeTiers={}; for(const p of prizes.rows)prizeTiers[p.matches]={winners:Number(p.winner_count),payout:Number(p.payout_per_winner),pool:Number(p.prize_pool)};
  return {latest:{drawId:d.id,date:dateText(d.draw_at),numbers:[d.number_1,d.number_2,d.number_3,d.number_4,d.number_5,d.number_6],jackpot:Number(d.jackpot),nextJackpot:Number(next.rows[0]?.value||d.jackpot),totalWinners,prizeTiers},previous:previous.rows.map(x=>({drawId:x.id,date:dateText(x.draw_at),numbers:[x.number_1,x.number_2,x.number_3,x.number_4,x.number_5,x.number_6],jackpot:Number(x.jackpot)}))};
});

function adminOk(request){const h=request.headers.authorization||'';return config.adminKey && h==='Bearer '+config.adminKey;}
app.post('/api/admin/draw/run', {config:{rateLimit:{max:10,timeWindow:'1 minute'}}}, async(request,reply)=>{if(!adminOk(request))return reply.code(401).send({message:'Unauthorized.'});try{return await runDueDraw(false)}catch(e){if(e.message==='DRAW_NOT_DUE')return reply.code(409).send({message:'The draw is not due yet.'});if(e.message==='NO_OPEN_DRAW')return reply.code(409).send({message:'No open draw exists.'});throw e;}});
app.post('/api/admin/draw/run-now', {config:{rateLimit:{max:5,timeWindow:'1 minute'}}}, async(request,reply)=>{if(!adminOk(request))return reply.code(401).send({message:'Unauthorized.'});try{return await runDueDraw(true)}catch(e){if(e.message==='NO_OPEN_DRAW')return reply.code(409).send({message:'No open draw exists.'});throw e;}});

app.setErrorHandler((error,request,reply)=>{request.log.error(error);if(error.code==='FST_ERR_CTP_INVALID_MEDIA_TYPE')return reply.code(415).send({message:'JSON is required.'});return reply.code(error.statusCode||500).send({message:error.statusCode&&error.statusCode<500?error.message:'Internal server error.'});});

await migrateDatabase();
await ensureNextDraw();
await app.listen({port:config.port,host:config.host});
