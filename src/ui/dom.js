// Small DOM helpers shared by the GUI modules.
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const FILES = 'abcdefgh';
export const sqName = (s) => FILES[s & 7] + ((s >> 3) + 1);
export const sqFromName = (n) => FILES.indexOf(n[0]) + 8 * (parseInt(n[1], 10) - 1);

export function download(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
    ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove(); return ok;
  }
}

export function safeFileName(name) {
  return (String(name || 'game').replace(/[^a-z0-9\- _]+/gi, '').trim().replace(/\s+/g, '-') || 'game').slice(0, 60);
}

let toastTimer = null;
export function toast(message) {
  const region = document.getElementById('toast');
  if (!region) return;
  region.textContent = message;
  region.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => region.classList.remove('show'), 3200);
}

export function formatDate(ms) {
  try { return new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return String(ms); }
}

export const REASON_TEXT = {
  checkmate: 'by checkmate',
  stalemate: 'by stalemate',
  threefold: 'by threefold repetition',
  'fifty-move': 'by the fifty-move rule',
  insufficient: 'because neither side has enough material to checkmate',
  resignation: 'by resignation',
  timeout: 'on time',
  agreement: 'by agreement',
  disconnect: 'because the other player left the game',
};

export function describeResult(info) {
  if (!info) return 'The game is in progress.';
  const reason = REASON_TEXT[info.reason] || '';
  if (info.result === '1/2-1/2') return `The game is drawn ${reason}.`;
  const winner = info.result === '1-0' ? 'White' : 'Black';
  return `${winner} wins ${reason}.`;
}
