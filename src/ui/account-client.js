// Session token and sync transport. The token never leaves this device except
// as a bearer header, and it is not one of the synced keys.
import {
  ACCOUNT_STORAGE_KEY,
  STORAGE_PREFIX,
  SYNC_STATE_KEY,
  applyWrites,
  isSyncKey,
  planSync,
  readSnapshot,
  unsyncedConflicts,
} from '../account-sync.js';

export const DEFAULT_API_BASE = 'http://127.0.0.1:8488';

function browserStore() {
  const store = globalThis.localStorage;
  if (!store) throw new Error('This browser cannot store an account on this device.');
  return store;
}

export function apiBase(backend = browserStore()) {
  try {
    const saved = backend.getItem('ornate-chess:api-base');
    if (typeof saved === 'string' && /^https?:\/\//.test(saved)) return saved.replace(/\/$/, '');
  } catch { /* use the default */ }
  return DEFAULT_API_BASE;
}

export function readAccount(backend = browserStore()) {
  try {
    const raw = backend.getItem(ACCOUNT_STORAGE_KEY);
    if (!raw) return null;
    const account = JSON.parse(raw);
    if (!account || typeof account.token !== 'string' || typeof account.username !== 'string' || typeof account.userId !== 'string') return null;
    return account;
  } catch {
    return null;
  }
}

export function writeAccount(account, backend = browserStore()) {
  backend.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(account));
  renderFooterNote(backend);
}

export function clearAccount(backend = browserStore()) {
  try { backend.removeItem(ACCOUNT_STORAGE_KEY); } catch { /* already gone */ }
  renderFooterNote(backend);
}

export function readSyncState(backend = browserStore()) {
  try {
    const raw = backend.getItem(SYNC_STATE_KEY);
    const state = raw ? JSON.parse(raw) : null;
    if (!state || typeof state !== 'object') return { userId: null, keys: {}, last: null };
    return { userId: state.userId || null, keys: state.keys && typeof state.keys === 'object' ? state.keys : {}, last: state.last || null };
  } catch {
    return { userId: null, keys: {}, last: null };
  }
}

export function writeSyncState(state, backend = browserStore()) {
  backend.setItem(SYNC_STATE_KEY, JSON.stringify(state));
}

export function footerText(account) {
  if (!account) return 'Ornate Chess runs entirely in this browser. Games, settings and puzzle progress are stored on this device only.';
  return `Signed in as ${account.username}. Saved games and progress are synced with the account server. Settings stay on this device.`;
}

export function renderFooterNote(backend = browserStore()) {
  const note = globalThis.document && document.getElementById('footer-note');
  if (!note) return;
  note.textContent = footerText(readAccount(backend));
}

export function describeSync(result) {
  if (!result) return '';
  if (result.offline) return 'The account server could not be reached. Your games and progress remain on this device.';
  if (result.signedOut) return 'The session has ended. Sign in again.';
  if (!result.ok) return result.message || 'The account server could not complete the sync.';
  const sent = result.pushed || 0;
  const brought = result.applied || 0;
  if (!sent && !brought) return 'Your account is already up to date.';
  const parts = ['Sync finished.'];
  if (sent) parts.push(`${sent} ${sent === 1 ? 'item was' : 'items were'} sent.`);
  if (brought) parts.push(`${brought} ${brought === 1 ? 'item was' : 'items were'} brought to this device.`);
  if (result.skipped && result.skipped.length) parts.push('Some items were too large to sync.');
  return parts.join(' ');
}

async function request(base, path, { method = 'GET', token, body } = {}) {
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    const error = new Error('The account server could not be reached. Your games and progress remain on this device.');
    error.offline = true;
    throw error;
  }
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  if (!response.ok) {
    const error = new Error((json && json.error) || 'The account server could not complete the request.');
    error.status = response.status;
    throw error;
  }
  return json;
}

let inflight = null;
let syncAgain = false;
let silentWrites = 0;
let syncTimer = null;

export function withoutAccountWatch(fn) {
  silentWrites += 1;
  try { return fn(); } finally { silentWrites -= 1; }
}

function publishSync(result) {
  const target = globalThis.window;
  if (target && typeof target.dispatchEvent === 'function') {
    target.dispatchEvent(new CustomEvent('ornate-sync', { detail: result }));
  }
}

/** Queue a sync after saved progress changes. Device settings do not count. */
export function noteAccountChange(storageKey) {
  if (silentWrites || typeof storageKey !== 'string' || !storageKey.startsWith(STORAGE_PREFIX)) return;
  if (!isSyncKey(storageKey.slice(STORAGE_PREFIX.length))) return;
  try { if (!readAccount()) return; } catch { return; }
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncNow().catch(() => { /* The account page shows the latest result. */ }); }, 400);
}

export function watchAccountChanges() {
  const storage = globalThis.localStorage;
  if (!storage || storage.__ornateWatch) return;
  const setItem = storage.setItem.bind(storage);
  const removeItem = storage.removeItem.bind(storage);
  storage.setItem = (key, value) => { setItem(key, value); noteAccountChange(key); };
  storage.removeItem = (key) => { removeItem(key); noteAccountChange(key); };
  storage.__ornateWatch = true;
}

export function syncNow(options = {}) {
  if (inflight) {
    syncAgain = true;
    return inflight;
  }
  inflight = runSync(options).finally(() => {
    inflight = null;
    if (!syncAgain) return;
    syncAgain = false;
    syncNow().catch(() => { /* A later change retries. */ });
  });
  return inflight;
}

async function runSync({ backend = browserStore(), token, userId, apiBase: base = apiBase(backend), now = Date.now(), prefer } = {}) {
  const account = token ? { token, userId } : readAccount(backend);
  if (!account || !account.token) return { ok: false, message: 'Sign in before syncing.' };
  const state = readSyncState(backend);
  if (state.userId && account.userId && state.userId !== account.userId) {
    return { ok: false, needsReplace: true, message: 'This device has progress for a different account.' };
  }
  let remote;
  try {
    remote = await request(base, '/api/sync', { token: account.token });
  } catch (error) {
    if (error.status === 401) {
      clearAccount(backend);
      return { ok: false, signedOut: true, message: describeSync({ signedOut: true }) };
    }
    const offline = Boolean(error.offline);
    const result = { ok: false, offline, message: error.message };
    writeSyncState({ ...state, userId: account.userId || state.userId, last: { at: now, ok: false, message: result.message } }, backend);
    publishSync(result);
    return result;
  }
  const localValues = readSnapshot(backend);
  const entries = remote.entries || [];
  const conflicts = unsyncedConflicts({ localValues, meta: state.keys, remote: entries });
  if (conflicts.length && prefer !== 'local' && prefer !== 'remote') {
    return {
      ok: false,
      needsChoice: true,
      message: 'This device and the account both have progress that differs. Choose which copy to keep.',
    };
  }
  const plan = planSync({
    localValues,
    meta: state.keys,
    remote: entries,
    now,
    prefer: prefer === 'remote' ? 'remote' : 'local',
  });
  withoutAccountWatch(() => {
    applyWrites(backend, plan.writeLocal);
    writeSyncState({
      userId: account.userId || state.userId,
      keys: plan.meta,
      last: state.last,
    }, backend);
  });
  if (plan.push.length) {
    try {
      await request(base, '/api/sync', { method: 'PUT', token: account.token, body: { entries: plan.push } });
    } catch (error) {
      if (error.status === 401) {
        clearAccount(backend);
        return { ok: false, signedOut: true, applied: plan.writeLocal.length, message: describeSync({ signedOut: true }) };
      }
      const result = {
        ok: false,
        offline: Boolean(error.offline),
        applied: plan.writeLocal.length,
        message: error.message,
      };
      writeSyncState({ userId: account.userId || state.userId, keys: plan.meta, last: { at: now, ok: false, message: result.message } }, backend);
      publishSync(result);
      return result;
    }
  }
  const result = {
    ok: true,
    pushed: plan.push.length,
    applied: plan.writeLocal.length,
    skipped: plan.skipped,
  };
  result.message = describeSync(result);
  writeSyncState({ userId: account.userId || state.userId, keys: plan.meta, last: { at: now, ok: true, message: result.message } }, backend);
  publishSync(result);
  return result;
}

export async function loginOrRegister({ kind, username, password, backend = browserStore(), apiBase: base = apiBase(backend) }) {
  const path = kind === 'register' ? '/api/auth/register' : '/api/auth/login';
  const json = await request(base, path, { method: 'POST', body: { username, password } });
  return { token: json.token, username: json.user.username, userId: json.user.id };
}

export async function logoutAccount({ backend = browserStore(), apiBase: base = apiBase(backend) } = {}) {
  const account = readAccount(backend);
  clearAccount(backend);
  if (!account) return;
  try {
    await request(base, '/api/auth/logout', { method: 'POST', token: account.token, body: {} });
  } catch {
    /* The local session is already cleared. */
  }
}
