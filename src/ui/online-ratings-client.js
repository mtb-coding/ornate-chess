// Loads the account's bullet, blitz and rapid ratings. The server is the
// source of those numbers. This device keeps a copy for the pages to draw.
import { apiBase, readAccount } from './account-client.js';
import { mods } from './modules.js';
import { normalizeOnlineRatings } from '../online-ratings.js';

export function readCachedRatings() {
  try {
    if (mods.storage && mods.storage.getOnlineRatings) return mods.storage.getOnlineRatings();
  } catch { /* storage can be blocked */ }
  return normalizeOnlineRatings(null);
}

export function storeRatings(doc) {
  const next = normalizeOnlineRatings(doc);
  try {
    if (mods.storage && mods.storage.setOnlineRatings) return mods.storage.setOnlineRatings(next);
  } catch { /* keep the normalized copy in memory only */ }
  return next;
}

/** Fetch the signed-in ratings. A signed-out page, or a quiet server, keeps the stored copy. */
export async function refreshOnlineRatings() {
  const account = readAccount();
  if (!account) return readCachedRatings();
  try {
    const response = await fetch(`${apiBase()}/api/ratings`, {
      headers: { authorization: `Bearer ${account.token}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return readCachedRatings();
    const json = await response.json();
    if (json && json.ratings) return storeRatings(json.ratings);
  } catch { /* The last copy on this device is shown instead. */ }
  return readCachedRatings();
}
