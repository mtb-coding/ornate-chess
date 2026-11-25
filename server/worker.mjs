// Separate low-priority process. It backs up the database and reviews finished games.
// Start: node server/worker.mjs
// The bundled Stockfish build is used only on this machine. It is not sent to players.
import path from 'node:path';
import { constants, setPriority } from 'node:os';
import { DEFAULT_DB_PATH, openDatabase, purgeExpired } from './db.mjs';
import { claimJob, ensureBackup, failJob, finishJob, runBackup, runReview } from './jobs.mjs';
import { REVIEW_DEPTH } from '../src/review.js';
import { createNodeEngine } from './stockfish-process.mjs';

const POLL_MS = 5000;

try {
  setPriority(constants.priority.PRIORITY_LOW);
} catch { /* The process still runs if the operating system refuses a lower priority. */ }

const file = process.env.ORNATE_DB || DEFAULT_DB_PATH;
const db = openDatabase(file);
const backupDir = path.join(path.dirname(file), 'backups');
let engine = null;

function analyser() {
  if (!engine) engine = createNodeEngine(undefined, { hash: 16 });
  return (fen, opts = {}) => engine.analyse(fen, {
    depth: opts.depth ?? REVIEW_DEPTH,
    multipv: opts.multipv ?? 2,
  });
}

async function tick() {
  try { purgeExpired(db); } catch (err) { console.error('[jobs]', err && err.message ? err.message : err); }
  ensureBackup(db);
  const job = claimJob(db);
  if (!job) return;
  try {
    let result;
    if (job.kind === 'backup') result = runBackup(db, { directory: backupDir });
    else if (job.kind === 'review') result = await runReview(db, job, { analyse: analyser() });
    else throw new Error('That background job is not known.');
    finishJob(db, job.id, result);
    console.log(`[jobs] ${job.kind} finished`);
  } catch (err) {
    const status = failJob(db, job.id, err);
    console.error(`[jobs] ${job.kind} ${status}: ${err && err.message ? err.message : err}`);
  }
}

console.log(`Ornate Chess background worker is watching ${file}`);
setInterval(() => { tick().catch((err) => console.error('[jobs]', err)); }, POLL_MS);
tick().catch((err) => console.error('[jobs]', err));

function stop() {
  if (engine) engine.quit();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
