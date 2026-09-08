CREATE TABLE IF NOT EXISTS users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS draws (
  id BIGSERIAL PRIMARY KEY,
  draw_at TIMESTAMPTZ NOT NULL UNIQUE,
  cutoff_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open','completed')) DEFAULT 'open',
  number_1 SMALLINT,
  number_2 SMALLINT,
  number_3 SMALLINT,
  number_4 SMALLINT,
  number_5 SMALLINT,
  number_6 SMALLINT,
  jackpot NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS draws_status_at_idx ON draws(status, draw_at);

CREATE TABLE IF NOT EXISTS tips (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  draw_id BIGINT NOT NULL REFERENCES draws(id) ON DELETE RESTRICT,
  number_1 SMALLINT NOT NULL,
  number_2 SMALLINT NOT NULL,
  number_3 SMALLINT NOT NULL,
  number_4 SMALLINT NOT NULL,
  number_5 SMALLINT NOT NULL,
  number_6 SMALLINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT tips_unique_user_draw UNIQUE(user_id, draw_id),
  CONSTRAINT tips_numbers_range CHECK (
    number_1 BETWEEN 1 AND 35 AND number_2 BETWEEN 1 AND 35 AND number_3 BETWEEN 1 AND 35 AND
    number_4 BETWEEN 1 AND 35 AND number_5 BETWEEN 1 AND 35 AND number_6 BETWEEN 1 AND 35
  )
);
CREATE INDEX IF NOT EXISTS tips_draw_idx ON tips(draw_id);
CREATE INDEX IF NOT EXISTS tips_user_idx ON tips(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS prizes (
  id BIGSERIAL PRIMARY KEY,
  draw_id BIGINT NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
  matches SMALLINT NOT NULL CHECK (matches BETWEEN 3 AND 6),
  winner_count BIGINT NOT NULL DEFAULT 0,
  prize_pool NUMERIC(14,2) NOT NULL DEFAULT 0,
  payout_per_winner NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(draw_id, matches)
);

CREATE TABLE IF NOT EXISTS tip_results (
  tip_id BIGINT PRIMARY KEY REFERENCES tips(id) ON DELETE CASCADE,
  matches SMALLINT NOT NULL CHECK (matches BETWEEN 0 AND 6),
  prize NUMERIC(14,2) NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS tip_results_matches_idx ON tip_results(matches);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO app_settings(key, value) VALUES ('next_jackpot', '1000000.00') ON CONFLICT (key) DO NOTHING;
