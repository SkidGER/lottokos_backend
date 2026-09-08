# SayLotto backend

This is the backend for the current SayLotto frontend. It uses Node.js, Fastify and PostgreSQL.

## What is included

- email/password registration
- login/logout with server-side sessions
- Argon2id password hashing
- secure HttpOnly/Secure cookie sessions
- account statistics and recent entries
- one tip per account per draw
- 6-of-35 validation
- Monday/Thursday 18:00 Europe/Berlin draws
- 17:55 Europe/Berlin cutoff
- automatic draw result generation
- automatic 3/4/5/6-match winner counting
- automatic per-winner prize calculation
- results API for `results.html`
- next-draw API for the play page
- admin draw endpoint
- health endpoint
- rate limiting, CORS and security headers
- PostgreSQL indexes and unique constraints
- systemd service/timer and nginx reverse-proxy example
- PostgreSQL backup script

## Important product assumption

SayLotto is treated as a free-to-play simulation. The prize values in the database are simulated values; this backend does not process payments or real-money gambling transactions.

The initial prize pool is configured with `STARTING_JACKPOT`. By default the prize shares are 50% for 6 matches, 25% for 5, 15% for 4 and 10% for 3. Unclaimed prize money rolls into the next jackpot.

If you want a different payout model, change the four `PRIZE_SHARE_*` environment variables before production.

## 1. VPS packages

On a fresh Debian/Ubuntu VPS install Node.js 22, PostgreSQL and nginx. Then:

```bash
sudo -u postgres psql
CREATE USER saylotto WITH PASSWORD 'CHOOSE_A_LONG_RANDOM_PASSWORD';
CREATE DATABASE saylotto OWNER saylotto;
\q
```

Create the application user and directory:

```bash
sudo useradd --system --home /opt/saylotto-backend --shell /usr/sbin/nologin saylotto
sudo mkdir -p /opt/saylotto-backend
sudo chown -R saylotto:saylotto /opt/saylotto-backend
```

Copy this project into `/opt/saylotto-backend`, then:

```bash
cd /opt/saylotto-backend
sudo -u saylotto cp .env.example .env
sudo nano .env
sudo -u saylotto npm install
sudo -u saylotto npm run migrate
```

Generate a strong admin key:

```bash
openssl rand -hex 32
```

Put that value into `ADMIN_KEY` in `.env`.

## 2. DNS

Create an A/AAAA record for:

`api.saylotto.com`

pointing to the VPS.

The frontend currently calls `https://api.saylotto.com`.

## 3. nginx + HTTPS

Copy:

```bash
sudo cp nginx/api.saylotto.com.conf /etc/nginx/sites-available/api.saylotto.com
sudo ln -s /etc/nginx/sites-available/api.saylotto.com /etc/nginx/sites-enabled/api.saylotto.com
sudo nginx -t
sudo systemctl reload nginx
```

Then obtain a certificate with your normal Certbot setup, for example:

```bash
sudo certbot --nginx -d api.saylotto.com
```

The API must be HTTPS in production because the session cookie is Secure.

## 4. Start the API

```bash
sudo cp systemd/saylotto-api.service /etc/systemd/system/
sudo cp systemd/saylotto-draw.service /etc/systemd/system/
sudo cp systemd/saylotto-draw.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now saylotto-api.service
sudo systemctl enable --now saylotto-draw.timer
```

Check:

```bash
curl https://api.saylotto.com/health
sudo systemctl status saylotto-api
sudo systemctl list-timers | grep saylotto
```

## 5. Backups

Set `DATABASE_URL` in the root environment used by the backup script, or adapt the script to source `/opt/saylotto-backend/.env`. A simple setup is:

```bash
sudo install -m 700 scripts/backup.sh /usr/local/bin/saylotto-backup
sudo crontab -e
```

Run it once per day. Store a second copy off the VPS if the database matters.

## API

### Public

- `GET /health`
- `GET /api/health`
- `GET /api/draw/next`
- `GET /api/results`
- `GET /api/auth/me`

### Authentication

- `POST /api/auth/register` `{ "email": "...", "password": "..." }`
- `POST /api/auth/login` `{ "email": "...", "password": "..." }`
- `POST /api/auth/logout`

### Authenticated

- `POST /api/tips` `{ "numbers": [1,2,3,4,5,6] }`
- `GET /api/account`
- `DELETE /api/account`

### Admin

Send `Authorization: Bearer <ADMIN_KEY>`.

- `POST /api/admin/draw/run` — only runs when the draw is due
- `POST /api/admin/draw/run-now` — force-run for testing

## Frontend integration

`frontend-index.html` is the current index with backend tip submission and jackpot loading added.

`frontend-results.html` is the current results page with its API URL changed from a relative `/api/results` to `https://api.saylotto.com/api/results`.

Replace your deployed `index.html` and `results.html` with those versions after reviewing them.

The existing `login.html`, `register.html` and `account.html` already use `https://api.saylotto.com` and `credentials: 'include'`.

## Security notes

Passwords are never stored as plaintext. Argon2id is used for password hashing. Session IDs are random server-generated values stored server-side and sent in an HttpOnly/Secure cookie. Because the current frontend is on `lottokos.pages.dev` while the API is on `api.saylotto.com`, the cookie uses `SameSite=None; Secure`; the server also checks allowed request origins. Do not put authentication tokens in localStorage.

## 6. Automated database backup

```bash
sudo install -m 700 scripts/backup.sh /usr/local/bin/saylotto-backup
sudo cp systemd/saylotto-backup.service /etc/systemd/system/
sudo cp systemd/saylotto-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now saylotto-backup.timer
```

The local backup keeps 14 days. For real production data, copy backups to a second machine/object-storage location as well.


## Render

The API runs the database migration automatically on startup. Set `DATABASE_URL`, `FRONTEND_URL`, `SESSION_SECRET`, and `NODE_ENV=production` in Render Environment Variables. Render requires the service to listen on `0.0.0.0`; this project is configured accordingly.
