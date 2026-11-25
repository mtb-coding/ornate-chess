// Sign-in and sync. Progress stays on the device when the server is off.
import { esc } from './dom.js';
import { CORNER, DIVIDER } from './ornament.js';
import { choiceDialog, confirmDialog } from './dialogs.js';
import { planReplace, applyWrites, readSnapshot } from '../account-sync.js';
import {
  apiBase,
  clearAccount,
  describeSync,
  loginOrRegister,
  logoutAccount,
  readAccount,
  readSyncState,
  renderFooterNote,
  syncNow,
  withoutAccountWatch,
  writeAccount,
  writeSyncState,
} from './account-client.js';

const fc = `<span class="fc tl">${CORNER}</span><span class="fc tr">${CORNER}</span><span class="fc bl">${CORNER}</span><span class="fc br">${CORNER}</span>`;
const USERNAME = /^[A-Za-z0-9_]{3,24}$/;

function validate(username, password) {
  if (!USERNAME.test(username)) return 'A username must be 3 to 24 characters and use only letters, numbers and underscores.';
  if (password.length < 8 || password.length > 128) return 'A password must be 8 to 128 characters.';
  return '';
}

export async function render(root) {
  if (typeof root.__accountCleanup === 'function') {
    root.__accountCleanup();
    root.__accountCleanup = null;
  }
  let disposed = false;
  const account = readAccount();
  const base = apiBase();
  const last = readSyncState().last;
  root.innerHTML = `
    <h1 class="page-title" id="title-account">Account</h1>
    <p class="lede">An account keeps saved games and progress on the server at ${esc(base)}. Those are synced automatically whenever they change. The application still works when that server is turned off. Settings stay on this device.</p>
    <div class="frame account-card">${fc}<div class="frame-inner">
      ${account ? signedIn(account, last) : signedOut()}
    </div></div>`;
  const status = root.querySelector('.account-status');
  const setStatus = (text) => { if (!disposed && status) status.textContent = text; };
  if (account) await bindSignedIn(root, account, setStatus);
  else bindSignedOut(root, setStatus);
  return () => {
    disposed = true;
    if (typeof root.__accountCleanup === 'function') {
      root.__accountCleanup();
      root.__accountCleanup = null;
    }
  };
}

function signedOut() {
  return `${DIVIDER}
    <form class="account-form" aria-label="Sign in or create an account">
      <label for="account-username">Username</label>
      <input id="account-username" class="field" name="username" autocomplete="username" required maxlength="24" spellcheck="false">
      <label for="account-password">Password</label>
      <input id="account-password" class="field" name="password" type="password" autocomplete="current-password" required minlength="8" maxlength="128">
      <p class="help">A password must be at least 8 characters. The username uses letters, numbers and underscores.</p>
      <div class="btn-row">
        <button class="btn primary" type="submit" data-act="login">Sign in</button>
        <button class="btn" type="submit" data-act="register">Create an account</button>
      </div>
      <p class="account-status" role="status"></p>
    </form>`;
}

function signedIn(account, last) {
  const previous = last && last.message ? last.message : 'Sync has not run yet during this visit.';
  return `${DIVIDER}
    <p>You are signed in as ${esc(account.username)}.</p>
    <p class="help">Saved games and progress are synced automatically after each change. Settings stay on this device.</p>
    <p class="help"><a href="#/player/${encodeURIComponent(account.username)}">Your public page</a> lists your ratings and finished games. <a href="#/following">Following</a> keeps the players you choose.</p>
    <p class="account-status" role="status">${esc(previous)}</p>
    <div class="btn-row">
      <button class="btn" type="button" data-act="logout">Sign out</button>
    </div>`;
}

function bindSignedOut(root, setStatus) {
  const form = root.querySelector('form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const act = event.submitter && event.submitter.dataset.act === 'register' ? 'register' : 'login';
    const username = form.username.value.trim();
    const password = form.password.value;
    const problem = validate(username, password);
    if (problem) { setStatus(problem); return; }
    const buttons = [...form.querySelectorAll('button')];
    buttons.forEach((button) => { button.disabled = true; });
    setStatus(act === 'register' ? 'The account is being created.' : 'The account server is being contacted.');
    try {
      const session = await loginOrRegister({ kind: act, username, password });
      const state = readSyncState();
      const local = readSnapshot(localStorage);
      const switching = state.userId && state.userId !== session.userId && Object.keys(local).length > 0;
      if (switching) {
        const agreed = await confirmDialog(
          'Replace progress on this device',
          `Signing in as ${session.username} will replace the saved games and progress on this device with that account. Settings on this device are kept. Do you want to sign in?`,
          { ok: 'Sign in', danger: true },
        );
        if (!agreed) {
          try { await fetch(`${apiBase()}/api/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${session.token}` } }); } catch { /* the token is discarded */ }
          setStatus('Sign-in was cancelled. Progress on this device was not changed.');
          buttons.forEach((button) => { button.disabled = false; });
          return;
        }
        const response = await fetch(`${apiBase()}/api/sync`, { headers: { authorization: `Bearer ${session.token}` }, signal: AbortSignal.timeout(8000) });
        const remote = await response.json().catch(() => null);
        if (!response.ok) throw new Error((remote && remote.error) || 'The account server could not complete the request.');
        const replaced = planReplace(local, (remote && remote.entries) || []);
        withoutAccountWatch(() => applyWrites(localStorage, replaced.writeLocal));
        writeAccount(session);
        writeSyncState({ userId: session.userId, keys: replaced.meta, last: { at: Date.now(), ok: true, message: 'Progress on this device was replaced with the account.' } });
        renderFooterNote();
        if (!root.isConnected) return;
        await render(root);
        return;
      }
      writeAccount(session);
      if (!state.userId) writeSyncState({ ...state, userId: session.userId });
      const result = await syncNow({ token: session.token, userId: session.userId });
      renderFooterNote();
      if (!root.isConnected) return;
      if (result && result.signedOut) { await render(root); return; }
      await render(root);
      const note = root.querySelector('.account-status');
      if (note && result) note.textContent = result.message || describeSync(result);
    } catch (error) {
      setStatus(error.message || 'The account server could not complete the request.');
      buttons.forEach((button) => { button.disabled = false; });
    }
  });
}

async function bindSignedIn(root, account, setStatus) {
  const logoutButton = root.querySelector('[data-act="logout"]');
  const onSync = (event) => {
    const result = event.detail;
    if (!result || result.needsChoice) return;
    setStatus(result.message || describeSync(result));
  };
  window.addEventListener('ornate-sync', onSync);
  const run = async () => {
    setStatus('The account server is being contacted.');
    let result = await syncNow({ token: account.token, userId: account.userId });
    if (result && result.needsChoice) {
      const choice = await choiceDialog(
        'Choose which progress to keep',
        'This device and the account both have saved games or progress that differ. Keeping this device replaces the account. Keeping the account replaces the progress on this device. Settings on this device are kept either way.',
        { ok: 'Keep this device', cancel: 'Keep the account', danger: true },
      );
      if (choice === 'ok') result = await syncNow({ token: account.token, userId: account.userId, prefer: 'local' });
      else if (choice === 'cancel') result = await syncNow({ token: account.token, userId: account.userId, prefer: 'remote' });
      else {
        setStatus('Sync was cancelled. Nothing was changed.');
        return;
      }
    }
    if (!root.isConnected) return;
    if (result && result.signedOut) { await render(root); return; }
    if (result && result.needsReplace) {
      setStatus(result.message);
      return;
    }
    setStatus((result && result.message) || describeSync(result));
  };
  logoutButton.addEventListener('click', async () => {
    logoutButton.disabled = true;
    await logoutAccount();
    if (root.isConnected) await render(root);
  });
  root.__accountCleanup = () => window.removeEventListener('ornate-sync', onSync);
  await run();
}
