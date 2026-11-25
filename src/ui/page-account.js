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
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(username, password, email, registering) {
  if (!USERNAME.test(username)) return 'A username must be 3 to 24 characters and use only letters, numbers and underscores.';
  if (password.length < 8 || password.length > 128) return 'A password must be 8 to 128 characters.';
  if (registering) {
    const value = typeof email === 'string' ? email.trim() : '';
    if (!value || value.length > 254 || /[\r\n]/.test(value) || !EMAIL.test(value)) return 'Enter an email address.';
  }
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
      <label for="account-email">Email</label>
      <input id="account-email" class="field" name="email" type="email" autocomplete="email" required maxlength="254" spellcheck="false">
      <p class="help">A password must be at least 8 characters. The username uses letters, numbers and underscores. The email is saved with the account. A password change sends its code to that address.</p>
      <div class="btn-row">
        <button class="btn primary" type="submit" data-act="login" formnovalidate>Sign in</button>
        <button class="btn" type="submit" data-act="register">Create an account</button>
      </div>
      <p class="account-status" role="status"></p>
    </form>
    ${DIVIDER}
    <form class="account-form" aria-label="Reset a forgotten password">
      <h2>Forgot your password</h2>
      <p class="help">A confirmation code is sent only to the email saved when the account was created. The password changes only after you enter that code.</p>
      <label for="recover-username">Username</label>
      <input id="recover-username" class="field" name="username" autocomplete="username" required maxlength="24" spellcheck="false">
      <label for="recover-password">New password</label>
      <input id="recover-password" class="field" name="next" type="password" autocomplete="new-password" required minlength="8" maxlength="128">
      <div class="btn-row"><button class="btn" type="submit" data-act="send">Send a confirmation code</button></div>
      <div class="recover-confirm" hidden>
        <label for="recover-code">Confirmation code</label>
        <input id="recover-code" class="field" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" spellcheck="false">
        <div class="btn-row"><button class="btn primary" type="submit" data-act="confirm">Set the new password</button></div>
      </div>
      <p class="recover-status" role="status"></p>
    </form>`;
}

function signedIn(account, last) {
  const previous = last && last.message ? last.message : 'Sync has not run yet during this visit.';
  return `${DIVIDER}
    <p>You are signed in as ${esc(account.username)}.</p>
    <p class="help">Saved games and progress are synced automatically after each change. Settings stay on this device.</p>
    <p class="help"><a href="#/player/${encodeURIComponent(account.username)}">Your public page</a> lists your ratings and finished games. <a href="#/following">Following</a> keeps the players you choose. <a href="#/friends">Friends</a> lists the players who accepted a request.</p>
    <p class="account-status" role="status">${esc(previous)}</p>
    <div class="btn-row">
      <button class="btn" type="button" data-act="logout">Sign out</button>
    </div>
    ${DIVIDER}
    <form class="account-form" aria-label="Change password">
      <h2>Change password</h2>
      <p class="help password-email-note">A confirmation code is sent to the email saved when this account was created.</p>
      <div class="password-fields">
        <label for="current-password">Current password</label>
        <input id="current-password" class="field" name="current" type="password" autocomplete="current-password" required minlength="8" maxlength="128">
        <label for="next-password">New password</label>
        <input id="next-password" class="field" name="next" type="password" autocomplete="new-password" required minlength="8" maxlength="128">
        <p class="help">The password changes only after you enter the code. This sign-in stays active.</p>
        <div class="btn-row"><button class="btn" type="submit" data-act="send">Send a confirmation code</button></div>
        <div class="password-confirm" hidden>
          <label for="password-code">Confirmation code</label>
          <input id="password-code" class="field" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" spellcheck="false">
          <div class="btn-row"><button class="btn primary" type="submit" data-act="confirm">Change password</button></div>
        </div>
      </div>
      <p class="password-status" role="status"></p>
    </form>
    ${DIVIDER}
    <form class="account-form" aria-label="Change email">
      <h2>Change email</h2>
      <p class="help email-change-note">A confirmation code is sent to the email already saved on this account. The new address is stored only after you enter that code.</p>
      <div class="email-fields">
        <label for="email-current">Current password</label>
        <input id="email-current" class="field" name="current" type="password" autocomplete="current-password" required minlength="8" maxlength="128">
        <label for="email-next">New email</label>
        <input id="email-next" class="field" name="email" type="email" autocomplete="email" required maxlength="254" spellcheck="false">
        <div class="btn-row"><button class="btn" type="submit" data-act="send">Send a confirmation code</button></div>
        <div class="email-confirm" hidden>
          <label for="email-code">Confirmation code</label>
          <input id="email-code" class="field" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" spellcheck="false">
          <div class="btn-row"><button class="btn primary" type="submit" data-act="confirm">Change email</button></div>
        </div>
      </div>
      <p class="email-status" role="status"></p>
    </form>
    ${DIVIDER}
    <form class="account-form" aria-label="Delete this account">
      <h2>Delete this account</h2>
      <p class="help">Deleting the account removes the ratings and the messages. Saved games on this device stay. This cannot be undone.</p>
      <label for="delete-password">Password</label>
      <input id="delete-password" class="field" name="password" type="password" autocomplete="current-password" required minlength="8" maxlength="128">
      <div class="btn-row"><button class="btn danger" type="submit">Delete the account</button></div>
      <p class="delete-status" role="status"></p>
    </form>`;
}

async function postJson(path, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error((json && json.error) || 'The account server could not complete the request.');
  return json;
}

function postAuth(path, token, body) {
  return postJson(path, body, token);
}

function bindSignedOut(root, setStatus) {
  const form = root.querySelector('form[aria-label="Sign in or create an account"]');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const act = event.submitter && event.submitter.dataset.act === 'register' ? 'register' : 'login';
    const username = form.username.value.trim();
    const password = form.password.value;
    const email = form.email.value.trim();
    const problem = validate(username, password, email, act === 'register');
    if (problem) { setStatus(problem); return; }
    const buttons = [...form.querySelectorAll('button')];
    buttons.forEach((button) => { button.disabled = true; });
    setStatus(act === 'register' ? 'The account is being created.' : 'The account server is being contacted.');
    try {
      const session = await loginOrRegister(act === 'register' ? { kind: act, username, password, email } : { kind: act, username, password });
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
  const recoverForm = root.querySelector('form[aria-label="Reset a forgotten password"]');
  const recoverStatus = recoverForm.querySelector('.recover-status');
  const recoverBox = recoverForm.querySelector('.recover-confirm');
  recoverForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const typedCode = recoverForm.code.value.trim();
    const confirm = (event.submitter && event.submitter.dataset.act === 'confirm')
      || (!recoverBox.hidden && document.activeElement === recoverForm.code && /^\d{6}$/.test(typedCode));
    const buttons = [...recoverForm.querySelectorAll('button')];
    if (confirm) {
      const username = recoverForm.username.value.trim();
      const code = recoverForm.code.value.trim();
      const problem = validate(username, 'long-enough', '', false);
      if (problem) { recoverStatus.textContent = problem; return; }
      if (!/^\d{6}$/.test(code)) {
        recoverStatus.textContent = 'Enter the six-digit confirmation code.';
        return;
      }
      buttons.forEach((button) => { button.disabled = true; });
      recoverStatus.textContent = 'The confirmation code is being checked.';
      try {
        await postJson('/api/auth/recover/confirm', { username, code });
        recoverForm.next.value = '';
        recoverForm.code.value = '';
        recoverBox.hidden = true;
        recoverStatus.textContent = 'The password has been changed. Sign in with the new password.';
      } catch (error) {
        recoverStatus.textContent = error.message || 'The account server could not complete the request.';
      }
      buttons.forEach((button) => { button.disabled = false; });
      return;
    }
    const username = recoverForm.username.value.trim();
    const next = recoverForm.next.value;
    const problem = validate(username, next, '', false);
    if (problem) { recoverStatus.textContent = problem; return; }
    buttons.forEach((button) => { button.disabled = true; });
    recoverStatus.textContent = 'The confirmation code is being sent.';
    try {
      const result = await postJson('/api/auth/recover', { username, next });
      recoverBox.hidden = false;
      recoverStatus.textContent = result && result.delivery === 'sent'
        ? 'A confirmation code was sent to the email saved for that account. The password has not changed.'
        : 'This server is not sending email yet. If that account has a saved email, the code was saved on the server. The password has not changed.';
    } catch (error) {
      recoverStatus.textContent = error.message || 'The account server could not complete the request.';
    }
    buttons.forEach((button) => { button.disabled = false; });
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
  const passwordForm = root.querySelector('form[aria-label="Change password"]');
  const emailForm = root.querySelector('form[aria-label="Change email"]');
  const deleteForm = root.querySelector('form[aria-label="Delete this account"]');
  const passwordStatus = root.querySelector('.password-status');
  const emailStatus = emailForm.querySelector('.email-status');
  const deleteStatus = root.querySelector('.delete-status');
  const confirmBox = passwordForm.querySelector('.password-confirm');
  const emailBox = emailForm.querySelector('.email-confirm');
  const passwordFields = passwordForm.querySelector('.password-fields');
  const emailFields = emailForm.querySelector('.email-fields');
  const emailNote = passwordForm.querySelector('.password-email-note');
  const emailChangeNote = emailForm.querySelector('.email-change-note');
  let savedEmail = '';
  const showAddress = (address) => {
    savedEmail = address;
    emailNote.textContent = `A confirmation code will be sent to ${address}.`;
    emailChangeNote.textContent = `A confirmation code will be sent to ${address}. The new address is stored only after you enter that code.`;
  };
  const hideAddress = (reason) => {
    savedEmail = '';
    passwordFields.hidden = true;
    emailFields.hidden = true;
    emailNote.textContent = reason;
    emailChangeNote.textContent = reason === 'This account has no email address, so the password cannot be changed.'
      ? 'This account has no email address, so the address cannot be changed.'
      : reason;
  };
  try {
    const me = await fetch(`${apiBase()}/api/auth/me`, { headers: { authorization: `Bearer ${account.token}` }, signal: AbortSignal.timeout(8000) });
    const profile = await me.json().catch(() => null);
    const address = me.ok && profile && profile.user && typeof profile.user.email === 'string' ? profile.user.email.trim() : '';
    if (address) showAddress(address);
    else {
      hideAddress(me.ok
        ? 'This account has no email address, so the password cannot be changed.'
        : 'The account server could not be contacted, so the password cannot be changed right now.');
    }
  } catch {
    hideAddress('The account server could not be contacted, so the password cannot be changed right now.');
  }
  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!savedEmail) {
      passwordStatus.textContent = emailNote.textContent;
      return;
    }
    const typedCode = passwordForm.code.value.trim();
    const confirm = (event.submitter && event.submitter.dataset.act === 'confirm')
      || (!confirmBox.hidden && document.activeElement === passwordForm.code && /^\d{6}$/.test(typedCode));
    const buttons = [...passwordForm.querySelectorAll('button')];
    if (confirm) {
      const code = passwordForm.code.value.trim();
      if (!/^\d{6}$/.test(code)) {
        passwordStatus.textContent = 'Enter the six-digit confirmation code.';
        return;
      }
      buttons.forEach((button) => { button.disabled = true; });
      passwordStatus.textContent = 'The confirmation code is being checked.';
      try {
        await postAuth('/api/auth/password/confirm', account.token, { code });
        passwordForm.current.value = '';
        passwordForm.next.value = '';
        passwordForm.code.value = '';
        confirmBox.hidden = true;
        passwordStatus.textContent = 'The password has been changed.';
      } catch (error) {
        passwordStatus.textContent = error.message || 'The account server could not complete the request.';
      }
      buttons.forEach((button) => { button.disabled = false; });
      return;
    }
    const current = passwordForm.current.value;
    const next = passwordForm.next.value;
    if (current.length < 8 || current.length > 128 || next.length < 8 || next.length > 128) {
      passwordStatus.textContent = 'A password must be 8 to 128 characters.';
      return;
    }
    if (current === next) {
      passwordStatus.textContent = 'Choose a password that is different from the current one.';
      return;
    }
    buttons.forEach((button) => { button.disabled = true; });
    passwordStatus.textContent = 'The confirmation code is being sent.';
    try {
      const result = await postAuth('/api/auth/password', account.token, { current, next });
      confirmBox.hidden = false;
      if (result && result.preview) {
        passwordStatus.textContent = `This server is not sending email yet. The confirmation code is ${result.preview}. Enter it below. The password has not changed.`;
      } else {
        passwordStatus.textContent = `A confirmation code was sent to ${result && result.email ? result.email : savedEmail}. Enter it below. The password has not changed.`;
      }
    } catch (error) {
      passwordStatus.textContent = error.message || 'The account server could not complete the request.';
    }
    buttons.forEach((button) => { button.disabled = false; });
  });
  emailForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!savedEmail) {
      emailStatus.textContent = emailChangeNote.textContent;
      return;
    }
    const typedCode = emailForm.code.value.trim();
    const confirm = (event.submitter && event.submitter.dataset.act === 'confirm')
      || (!emailBox.hidden && document.activeElement === emailForm.code && /^\d{6}$/.test(typedCode));
    const buttons = [...emailForm.querySelectorAll('button')];
    if (confirm) {
      const code = emailForm.code.value.trim();
      if (!/^\d{6}$/.test(code)) {
        emailStatus.textContent = 'Enter the six-digit confirmation code.';
        return;
      }
      buttons.forEach((button) => { button.disabled = true; });
      emailStatus.textContent = 'The confirmation code is being checked.';
      try {
        const result = await postAuth('/api/auth/email/confirm', account.token, { code });
        const address = result && typeof result.email === 'string' ? result.email : savedEmail;
        showAddress(address);
        emailForm.current.value = '';
        emailForm.email.value = '';
        emailForm.code.value = '';
        emailBox.hidden = true;
        emailStatus.textContent = 'The email has been changed.';
      } catch (error) {
        emailStatus.textContent = error.message || 'The account server could not complete the request.';
      }
      buttons.forEach((button) => { button.disabled = false; });
      return;
    }
    const current = emailForm.current.value;
    const next = emailForm.email.value.trim();
    if (current.length < 8 || current.length > 128) {
      emailStatus.textContent = 'A password must be 8 to 128 characters.';
      return;
    }
    if (!next || next.length > 254 || /[\r\n]/.test(next) || !EMAIL.test(next)) {
      emailStatus.textContent = 'Enter an email address.';
      return;
    }
    if (next.toLowerCase() === savedEmail.toLowerCase()) {
      emailStatus.textContent = 'That is already the email on this account.';
      return;
    }
    buttons.forEach((button) => { button.disabled = true; });
    emailStatus.textContent = 'The confirmation code is being sent.';
    try {
      const result = await postAuth('/api/auth/email', account.token, { current, email: next });
      emailBox.hidden = false;
      if (result && result.preview) {
        emailStatus.textContent = `This server is not sending email yet. The confirmation code is ${result.preview}. Enter it below. The email has not changed.`;
      } else {
        emailStatus.textContent = `A confirmation code was sent to ${result && result.email ? result.email : savedEmail}. Enter it below. The email has not changed.`;
      }
    } catch (error) {
      emailStatus.textContent = error.message || 'The account server could not complete the request.';
    }
    buttons.forEach((button) => { button.disabled = false; });
  });
  deleteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = deleteForm.password.value;
    if (password.length < 8 || password.length > 128) {
      deleteStatus.textContent = 'A password must be 8 to 128 characters.';
      return;
    }
    const agreed = await confirmDialog(
      'Delete this account',
      'The account, its ratings, and its messages will be removed. Saved games on this device stay. This cannot be undone.',
      { ok: 'Delete the account', danger: true },
    );
    if (!agreed || !root.isConnected) return;
    const button = deleteForm.querySelector('button');
    button.disabled = true;
    deleteStatus.textContent = 'The account is being deleted.';
    try {
      await postAuth('/api/auth/delete', account.token, { password });
      clearAccount();
      renderFooterNote();
      if (root.isConnected) await render(root);
    } catch (error) {
      button.disabled = false;
      deleteStatus.textContent = error.message || 'The account server could not complete the request.';
    }
  });
  root.__accountCleanup = () => window.removeEventListener('ornate-sync', onSync);
  await run();
}
