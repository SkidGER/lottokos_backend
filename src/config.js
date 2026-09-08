import 'dotenv/config';
export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '127.0.0.1',
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean),
  adminKey: process.env.ADMIN_KEY || '',
  timezone: process.env.TIMEZONE || 'Europe/Berlin',
  drawHour: Number(process.env.DRAW_HOUR || 18),
  drawMinute: Number(process.env.DRAW_MINUTE || 0),
  cutoffHour: Number(process.env.CUTOFF_HOUR || 17),
  cutoffMinute: Number(process.env.CUTOFF_MINUTE || 55),
  startingJackpot: Number(process.env.STARTING_JACKPOT || 1000000),
  prizeShares: { 6: Number(process.env.PRIZE_SHARE_6 || .50), 5: Number(process.env.PRIZE_SHARE_5 || .25), 4: Number(process.env.PRIZE_SHARE_4 || .15), 3: Number(process.env.PRIZE_SHARE_3 || .10) },
  sessionDays: Number(process.env.SESSION_DAYS || 30),
  cookieName: process.env.COOKIE_NAME || '__Host-saylotto_session'
};
const shareTotal = Object.values(config.prizeShares).reduce((a,b)=>a+b,0);
if (Math.abs(shareTotal - 1) > 0.0001) throw new Error('Prize shares must add up to 1.0');
