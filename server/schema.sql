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
  updated_at INTEGER NOT NULL,
  move_times_json TEXT NOT NULL DEFAULT '[]',
  chat_status TEXT NOT NULL DEFAULT 'closed',
  chat_by TEXT,
  chat_json TEXT NOT NULL DEFAULT '[]'
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

CREATE TABLE IF NOT EXISTS game_reviews (
  game_id TEXT PRIMARY KEY,
  depth INTEGER NOT NULL,
  review_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS game_puzzles (
  id TEXT PRIMARY KEY,
  game_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  color TEXT NOT NULL,
  ply INTEGER NOT NULL,
  puzzle_json TEXT NOT NULL,
  solved INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  used_hint INTEGER NOT NULL,
  removed INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS game_puzzles_move ON game_puzzles(game_id, user_id, ply);
CREATE INDEX IF NOT EXISTS game_puzzles_user ON game_puzzles(user_id, created_at);

CREATE TABLE IF NOT EXISTS cheat_flags (
  game_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  pace TEXT NOT NULL,
  color TEXT NOT NULL,
  moves INTEGER NOT NULL,
  matches INTEGER NOT NULL,
  average_loss REAL NOT NULL,
  created_at INTEGER NOT NULL,
  timing_supported INTEGER NOT NULL DEFAULT 0,
  median_ms INTEGER,
  cleared_at INTEGER,
  PRIMARY KEY (game_id, user_id)
);
CREATE INDEX IF NOT EXISTS cheat_flags_player ON cheat_flags(user_id, pace);

CREATE TABLE IF NOT EXISTS appeals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pace TEXT NOT NULL,
  note TEXT NOT NULL,
  status TEXT NOT NULL,
  decision TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS appeals_user ON appeals(user_id, pace, created_at);

CREATE TABLE IF NOT EXISTS follows (
  follower_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followed_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (follower_id, followed_id)
);
CREATE INDEX IF NOT EXISTS follows_followed ON follows(followed_id);

CREATE TABLE IF NOT EXISTS message_threads (
  id TEXT PRIMARY KEY,
  user_a TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_b TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (user_a, user_b)
);

CREATE TABLE IF NOT EXISTS direct_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES message_threads(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS direct_messages_thread ON direct_messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS direct_messages_sender ON direct_messages(sender_id, created_at);

CREATE TABLE IF NOT EXISTS sync_entries (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value_json TEXT,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, key)
);
