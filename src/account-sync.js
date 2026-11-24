// Pure sync planning. The browser client and the Node tests both use this.
// Settings, autosave and GUI preferences are not sync keys.

export const STORAGE_PREFIX = 'ornate-chess:';
export const ACCOUNT_STORAGE_KEY = `${STORAGE_PREFIX}account`;
export const SYNC_STATE_KEY = `${STORAGE_PREFIX}sync-state`;

export const FIXED_SYNC_KEYS = [
  'games',
  'stats',
  'puzzle-progress',
  'player-rating',
  'endgame-progress',
  'reviews-index',
  'mistake-puzzles',
  'gen-pool-v2',
  'gen-stats',
];

const REVIEW_KEY = /^review:[a-z0-9]{1,16}$/;
const MAX_REVIEWS = 30;
const MAX_GAMES = 50;
const MAX_MISTAKES = 200;
const MAX_BYTES = 1024 * 1024;

export function isSyncKey(key) {
  return FIXED_SYNC_KEYS.includes(key) || REVIEW_KEY.test(key);
}

export function hashValue(value) {
  const raw = JSON.stringify(value);
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${raw.length}:${(h >>> 0).toString(36)}`;
}

function byteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function isVacant(key, value) {
  if (value == null) return true;
  if (key === 'games') return Array.isArray(value) && value.length === 0;
  if (key === 'stats') return !value.totals || !value.totals.games;
  if (key === 'puzzle-progress') return !value.puzzles || Object.keys(value.puzzles).length === 0;
  if (key === 'player-rating') return !value.games;
  if (key === 'endgame-progress') return !value.positions || Object.keys(value.positions).length === 0;
  if (key === 'reviews-index') return !value.order || value.order.length === 0;
  if (key === 'mistake-puzzles') return !Array.isArray(value.puzzles) || value.puzzles.length === 0;
  if (key === 'gen-stats') return !value.attempted && !value.solved;
  if (key === 'gen-pool-v2') {
    if (typeof value !== 'object' || Array.isArray(value)) return true;
    return Object.values(value).every((list) => !Array.isArray(list) || list.length === 0);
  }
  return false;
}

function prepareLocal(key, value) {
  if (key === 'games') {
    if (!Array.isArray(value)) return { skip: 'Saved games must be an array.' };
    if (value.length > MAX_GAMES) return { value: value.slice(0, MAX_GAMES), trimmed: true };
  }
  if (key === 'mistake-puzzles' && value && typeof value === 'object' && Array.isArray(value.puzzles) && value.puzzles.length > MAX_MISTAKES) {
    return { value: { ...value, puzzles: value.puzzles.slice(-MAX_MISTAKES) }, trimmed: true };
  }
  if (byteLength(value) > MAX_BYTES) return { skip: `The value for ${key} is larger than 1 MB.` };
  return { value, trimmed: false };
}

export function readSnapshot(backend) {
  const values = {};
  const take = (syncKey, raw) => {
    if (raw == null || raw === '') return;
    try {
      values[syncKey] = JSON.parse(raw);
    } catch {
      /* Damaged JSON stays on the device and is not uploaded. */
    }
  };
  for (const key of FIXED_SYNC_KEYS) take(key, backend.getItem(STORAGE_PREFIX + key));
  if (typeof backend.length === 'number' && typeof backend.key === 'function') {
    for (let i = 0; i < backend.length; i++) {
      const storageKey = backend.key(i);
      if (!storageKey || !storageKey.startsWith(`${STORAGE_PREFIX}review:`)) continue;
      const syncKey = storageKey.slice(STORAGE_PREFIX.length);
      if (isSyncKey(syncKey)) take(syncKey, backend.getItem(storageKey));
    }
  }
  return values;
}

export function applyWrites(backend, writes) {
  for (const entry of writes) {
    const storageKey = STORAGE_PREFIX + entry.key;
    if (entry.deleted) backend.removeItem(storageKey);
    else backend.setItem(storageKey, JSON.stringify(entry.value));
  }
}

function upsert(list, entry) {
  const index = list.findIndex((item) => item.key === entry.key);
  if (index >= 0) list[index] = entry;
  else list.push(entry);
}

/**
 * Decide which keys to write locally and which to upload.
 * A missing local stamp does not let an empty default replace account data.
 */
/** Keys where this device and the account both have real, different data and no local stamp yet. */
export function unsyncedConflicts({ localValues = {}, meta = {}, remote = [] } = {}) {
  const conflicts = [];
  for (const entry of remote) {
    if (!entry || entry.deleted || !isSyncKey(entry.key) || meta[entry.key]) continue;
    if (!Object.prototype.hasOwnProperty.call(localValues, entry.key)) continue;
    const value = localValues[entry.key];
    if (isVacant(entry.key, value) || isVacant(entry.key, entry.value)) continue;
    if (hashValue(value) !== hashValue(entry.value)) conflicts.push(entry.key);
  }
  return conflicts;
}

export function planSync({ localValues = {}, meta = {}, remote = [], now = Date.now(), prefer = 'local' } = {}) {
  const remoteMap = new Map();
  for (const entry of remote) {
    if (entry && typeof entry.key === 'string' && isSyncKey(entry.key) && Number.isInteger(entry.updatedAt)) {
      remoteMap.set(entry.key, entry);
    }
  }
  const keys = new Set([
    ...Object.keys(localValues).filter(isSyncKey),
    ...Object.keys(meta).filter(isSyncKey),
    ...remoteMap.keys(),
  ]);

  const writeLocal = [];
  const push = [];
  const skipped = [];
  const nextMeta = {};

  for (const key of keys) {
    const remoteEntry = remoteMap.get(key) || null;
    const known = Object.prototype.hasOwnProperty.call(localValues, key);
    let prepared = null;
    if (known) {
      prepared = prepareLocal(key, localValues[key]);
      if (prepared.skip) {
        skipped.push({ key, reason: prepared.skip });
        if (meta[key]) nextMeta[key] = { ...meta[key] };
        continue;
      }
    }
    const value = prepared ? prepared.value : null;
    const hash = prepared ? hashValue(value) : null;
    const prior = meta[key] || null;
    let deleted = !prepared;
    let updatedAt = prior ? prior.updatedAt : 0;
    let changed = false;

    if (prepared) {
      if (!prior || prior.deleted || prior.hash !== hash || prepared.trimmed) {
        updatedAt = prior && prior.updatedAt >= now ? prior.updatedAt + 1 : now;
        changed = true;
      }
      deleted = false;
    } else if (prior && !prior.deleted) {
      updatedAt = prior.updatedAt >= now ? prior.updatedAt + 1 : now;
      deleted = true;
      changed = true;
    } else if (prior && prior.deleted) {
      deleted = true;
      updatedAt = prior.updatedAt;
    } else {
      deleted = true;
      updatedAt = 0;
    }

    if (!prior && prepared && remoteEntry && !changed) {
      /* hash matched a prior we do not have; handled below */
    }

    if (!prior) {
      const remoteDeleted = remoteEntry ? remoteEntry.deleted === true : false;
      const localVacant = !prepared || isVacant(key, value);
      const remoteVacant = !remoteEntry || remoteDeleted || isVacant(key, remoteEntry.value);
      if (remoteEntry && !remoteDeleted && (localVacant || !prepared)) {
        writeLocal.push({ key, value: remoteEntry.value, deleted: false, updatedAt: remoteEntry.updatedAt });
        nextMeta[key] = { updatedAt: remoteEntry.updatedAt, hash: hashValue(remoteEntry.value), deleted: false };
        continue;
      }
      if (remoteEntry && remoteDeleted && localVacant) {
        if (prepared) writeLocal.push({ key, value: null, deleted: true, updatedAt: remoteEntry.updatedAt });
        nextMeta[key] = { updatedAt: remoteEntry.updatedAt, hash: null, deleted: true };
        continue;
      }
      if (prepared && !localVacant && remoteEntry && !remoteDeleted && !remoteVacant && hashValue(remoteEntry.value) !== hash) {
        if (prefer === 'remote') {
          writeLocal.push({ key, value: remoteEntry.value, deleted: false, updatedAt: remoteEntry.updatedAt });
          nextMeta[key] = { updatedAt: remoteEntry.updatedAt, hash: hashValue(remoteEntry.value), deleted: false };
          continue;
        }
        updatedAt = now;
        changed = true;
      } else if (prepared && !localVacant && (!remoteEntry || remoteVacant)) {
        updatedAt = now;
        changed = true;
        deleted = false;
      } else if (prepared && remoteEntry && !remoteEntry.deleted && hashValue(remoteEntry.value) === hash) {
        nextMeta[key] = { updatedAt: remoteEntry.updatedAt, hash, deleted: false };
        continue;
      } else if (!prepared && !remoteEntry) {
        continue;
      } else if (prepared && isVacant(key, value) && !remoteEntry) {
        continue;
      }
    }

    if (remoteEntry && remoteEntry.updatedAt > updatedAt) {
      const remoteDeleted = remoteEntry.deleted === true;
      writeLocal.push({
        key,
        value: remoteDeleted ? null : remoteEntry.value,
        deleted: remoteDeleted,
        updatedAt: remoteEntry.updatedAt,
      });
      nextMeta[key] = {
        updatedAt: remoteEntry.updatedAt,
        hash: remoteDeleted ? null : hashValue(remoteEntry.value),
        deleted: remoteDeleted,
      };
      continue;
    }

    if (remoteEntry && remoteEntry.updatedAt === updatedAt && !changed) {
      const remoteDeleted = remoteEntry.deleted === true;
      const same = remoteDeleted === deleted && (deleted || hashValue(remoteEntry.value) === hash);
      if (same) {
        nextMeta[key] = { updatedAt, hash: deleted ? null : hash, deleted };
        continue;
      }
      updatedAt += 1;
      changed = true;
    }

    if (deleted && !prior) continue;
    if (deleted && prior && prior.deleted && (!remoteEntry || (remoteEntry.deleted && remoteEntry.updatedAt >= updatedAt))) {
      nextMeta[key] = { updatedAt: prior.updatedAt, hash: null, deleted: true };
      continue;
    }

    if (prepared && prepared.trimmed) {
      writeLocal.push({ key, value, deleted: false, updatedAt });
    }
    if (!remoteEntry || remoteEntry.updatedAt < updatedAt || changed) {
      if (!(deleted && !remoteEntry && prior && prior.deleted)) {
        push.push({ key, value: deleted ? null : value, deleted, updatedAt });
      }
    }
    nextMeta[key] = { updatedAt, hash: deleted ? null : hash, deleted };
  }

  const live = [...keys].filter((key) => nextMeta[key] && !nextMeta[key].deleted && key.startsWith('review:'));
  if (live.length > MAX_REVIEWS) {
    live.sort((a, b) => nextMeta[a].updatedAt - nextMeta[b].updatedAt || (a < b ? -1 : 1));
    for (const key of live.slice(0, live.length - MAX_REVIEWS)) {
      const stamp = Math.max(now, (nextMeta[key].updatedAt || 0) + 1);
      nextMeta[key] = { updatedAt: stamp, hash: null, deleted: true };
      upsert(writeLocal, { key, value: null, deleted: true, updatedAt: stamp });
      upsert(push, { key, value: null, deleted: true, updatedAt: stamp });
    }
  }

  return { writeLocal, push, meta: nextMeta, skipped };
}

/** First sign-in of a different account: the server snapshot replaces sync keys. */
export function planReplace(localValues, remote, now = Date.now()) {
  const remoteMap = new Map();
  for (const entry of remote) {
    if (entry && isSyncKey(entry.key) && Number.isInteger(entry.updatedAt)) remoteMap.set(entry.key, entry);
  }
  const writeLocal = [];
  const meta = {};
  for (const [key, entry] of remoteMap) {
    const deleted = entry.deleted === true;
    writeLocal.push({ key, value: deleted ? null : entry.value, deleted, updatedAt: entry.updatedAt });
    meta[key] = { updatedAt: entry.updatedAt, hash: deleted ? null : hashValue(entry.value), deleted };
  }
  for (const key of Object.keys(localValues)) {
    if (!isSyncKey(key) || remoteMap.has(key)) continue;
    writeLocal.push({ key, value: null, deleted: true, updatedAt: now });
  }
  return { writeLocal, meta };
}
