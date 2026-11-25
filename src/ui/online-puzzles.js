// Mistake puzzles created on the account server from finished online games.
import { apiBase, readAccount } from './account-client.js';

function account() {
  try { return readAccount(); } catch { return null; }
}

async function send(path, { method = 'GET', body } = {}) {
  const who = account();
  if (!who) return null;
  const response = await fetch(`${apiBase()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${who.token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) throw new Error('The account server could not update that position.');
  return response.json();
}

/** Puzzles from the signed-in player's online games. An empty list when signed out or offline. */
export async function listOnlinePuzzles() {
  try {
    const json = await send('/api/puzzles');
    const list = json && Array.isArray(json.puzzles) ? json.puzzles : [];
    return list.map((puzzle) => ({ ...puzzle, source: 'online' }));
  } catch {
    return [];
  }
}

export async function markOnlinePuzzle(id, fields) {
  const json = await send(`/api/puzzles/${encodeURIComponent(id)}`, { method: 'POST', body: fields });
  return json && json.puzzle ? { ...json.puzzle, source: 'online' } : null;
}

export async function removeOnlinePuzzle(id) {
  await send(`/api/puzzles/${encodeURIComponent(id)}`, { method: 'POST', body: { removed: true } });
}
