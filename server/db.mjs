// SQLite open and migration. The file is created on first use.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_DB_PATH = path.join(SERVER_DIR, 'data', 'ornate.sqlite');
const SCHEMA_VERSION = 12;

const LIVE_GAMES_SQL = `
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
`;

function addColumn(db, table, name, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((col) => col.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
}

export function openDatabase(file = DEFAULT_DB_PATH) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  let version = Number(db.prepare('PRAGMA user_version').get().user_version) || 0;
  if (version < 1) {
    db.exec(fs.readFileSync(path.join(SERVER_DIR, 'schema.sql'), 'utf8'));
    version = 1;
  }
  if (version < 2) {
    db.exec(LIVE_GAMES_SQL);
    version = 2;
  }
  if (version < 3) {
    db.exec(`CREATE TABLE IF NOT EXISTS pace_ratings (
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
    )`);
    version = 3;
  }
  if (version < 4) {
    db.exec(`CREATE TABLE pace_ratings_v4 (
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
    )`);
    const exists = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'pace_ratings'").get();
    if (exists) {
      db.exec(`INSERT INTO pace_ratings_v4 (
        user_id, pace, rating, deviation, volatility, games, wins, draws, losses, peak,
        white_json, black_json, history_json, updated_at
      )
      SELECT user_id, pace, rating, deviation, volatility, games, wins, draws, losses,
        CASE WHEN deviation > 110 THEN NULL ELSE peak END,
        white_json, black_json, history_json, updated_at
      FROM pace_ratings`);
      db.exec('DROP TABLE pace_ratings');
    }
    db.exec('ALTER TABLE pace_ratings_v4 RENAME TO pace_ratings');
    version = 4;
  }
  if (version < 5) {
    db.exec(`CREATE TABLE IF NOT EXISTS jobs (
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
    CREATE INDEX IF NOT EXISTS jobs_ready ON jobs(status, run_after);`);
    version = 5;
  }
  if (version < 6) {
    db.exec(`CREATE TABLE IF NOT EXISTS game_reviews (
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
    CREATE INDEX IF NOT EXISTS game_puzzles_user ON game_puzzles(user_id, created_at);`);
    version = 6;
  }
  if (version < 7) {
    db.exec(`CREATE TABLE IF NOT EXISTS cheat_flags (
      game_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      pace TEXT NOT NULL,
      color TEXT NOT NULL,
      moves INTEGER NOT NULL,
      matches INTEGER NOT NULL,
      average_loss REAL NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (game_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS cheat_flags_player ON cheat_flags(user_id, pace);`);
    version = 7;
  }
  if (version < 8) {
    addColumn(db, 'live_games', 'move_times_json', "move_times_json TEXT NOT NULL DEFAULT '[]'");
    addColumn(db, 'cheat_flags', 'timing_supported', 'timing_supported INTEGER NOT NULL DEFAULT 0');
    addColumn(db, 'cheat_flags', 'median_ms', 'median_ms INTEGER');
    addColumn(db, 'cheat_flags', 'cleared_at', 'cleared_at INTEGER');
    db.exec(`CREATE TABLE IF NOT EXISTS appeals (
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
    CREATE INDEX IF NOT EXISTS follows_followed ON follows(followed_id);`);
    version = 8;
  }
  if (version < 9) {
    addColumn(db, 'live_games', 'chat_status', "chat_status TEXT NOT NULL DEFAULT 'closed'");
    addColumn(db, 'live_games', 'chat_by', 'chat_by TEXT');
    addColumn(db, 'live_games', 'chat_json', "chat_json TEXT NOT NULL DEFAULT '[]'");
    db.exec(`CREATE TABLE IF NOT EXISTS message_threads (
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
    CREATE INDEX IF NOT EXISTS direct_messages_sender ON direct_messages(sender_id, created_at);`);
    version = 9;
  }
  if (version < 10) {
    addColumn(db, 'users', 'email', 'email TEXT');
    addColumn(db, 'users', 'email_verified', 'email_verified INTEGER NOT NULL DEFAULT 0');
    db.exec(`CREATE TABLE IF NOT EXISTS password_resets (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      next_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`);
    version = 10;
  }
  if (version < 11) {
    addColumn(db, 'password_resets', 'purpose', "purpose TEXT NOT NULL DEFAULT 'password'");
    db.exec(`CREATE TABLE IF NOT EXISTS challenges (
      id TEXT PRIMARY KEY,
      from_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      from_name TEXT NOT NULL,
      to_name TEXT NOT NULL,
      base_ms INTEGER NOT NULL,
      inc_ms INTEGER NOT NULL,
      color TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS challenges_to ON challenges(to_id, expires_at);
    CREATE INDEX IF NOT EXISTS challenges_from ON challenges(from_id);`);
    version = 11;
  }
  if (version < 12) {
    db.exec(`CREATE TABLE IF NOT EXISTS friendships (
      user_low TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_high TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_low, user_high)
    );
    CREATE INDEX IF NOT EXISTS friendships_low ON friendships(user_low, status);
    CREATE INDEX IF NOT EXISTS friendships_high ON friendships(user_high, status);`);
    version = 12;
  }
  db.exec(`PRAGMA user_version = ${version}`);
  return db;
}
