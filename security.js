import crypto from 'node:crypto';
import argon2 from 'argon2';
import { config } from './config.js';
import { query } from './db.js';

export async function hashPassword(password) {
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}
export async function verifyPassword(hash, password) { return argon2.verify(hash, password); }
export function sessionToken() { return crypto.randomBytes(32).toString('base64url'); }
export async function createSession(userId) {
  const token = sessionToken();
  const expires = new Date(Date.now() + config.sessionDays * 86400000);
  await query('INSERT INTO sessions(id,user_id,expires_at) VALUES($1,$2,$3)', [token, userId, expires]);
  return { token, expires };
}
export async function getSessionUser(request) {
  const token = request.cookies?.[config.cookieName];
  if (!token) return null;
  const r = await query(`SELECT u.id,u.email,s.id AS session_id,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.expires_at>now()`, [token]);
  return r.rows[0] || null;
}
export async function deleteSession(request) {
  const token = request.cookies?.[config.cookieName];
  if (token) await query('DELETE FROM sessions WHERE id=$1', [token]);
}
export function setSessionCookie(reply, token, expires) {
  reply.setCookie(config.cookieName, token, { httpOnly:true, secure:true, sameSite:'none', path:'/', expires });
}
export function clearSessionCookie(reply) { reply.clearCookie(config.cookieName, { httpOnly:true, secure:true, sameSite:'none', path:'/' }); }
