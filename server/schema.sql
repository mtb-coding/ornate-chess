CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_fold TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS live_games (
  id TEXT PRIMARY KEY,
  base_ms INTEGER NOT NULL,
  inc_ms INTEGER NOT NULL,
  white_id TEXT NOT NULL,
  black_id TEXT NOT NULL,
  white_name TEXT NOT NULL,
  black_name TEXT NOT NULL,
  game_json TEXT NOT NULL,
  w_ms INTEGER NOT NULL,
  b_ms INTEGER NOT NULL,
  turn_started_at INTEGER,
  status TEXT NOT NULL,
  result TEXT,
  result_reason TEXT,
  draw_offer TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS live_games_white ON live_games(white_id, status);
CREATE INDEX IF NOT EXISTS live_games_black ON live_games(black_id, status);

CREATE TABLE IF NOT EXISTS pace_ratings (
  user_id TEXT NOT NULL,
  pace TEXT NOT NULL,
  rating REAL NOT NULL,
  deviation REAL NOT NULL,
  volatility REAL NOT NULL,
  games INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  draws INTEGER NOT NULL,
  losses INTEGER NOT NULL,
  peak REAL,
  white_json TEXT NOT NULL,
  black_json TEXT NOT NULL,
  history_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, pace)
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  run_after INTEGER NOT NULL,
  last_error TEXT,
  result_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_ready ON jobs(status, run_after);

CREATE TABLE IF NOT EXISTS sync_entries (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value_json TEXT,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, key)
);
