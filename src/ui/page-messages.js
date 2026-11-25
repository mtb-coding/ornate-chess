// Off-game messages. A vertical list of people, and the open conversation beside it.
import { esc, formatDate } from './dom.js';
import { apiBase, readAccount } from './account-client.js';
import { markThreadSeen, noteInbox } from './message-notice.js';

const HINT = {
  incoming: 'Request',
  outgoing: 'Waiting',
  declined: 'Declined',
  none: 'New',
};

let generation = 0;

async function api(path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body) headers['content-type'] = 'application/json';
  const response = await fetch(`${apiBase()}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json && json.error ? json.error : 'The message could not be sent.');
  return json;
}

function sameUser(a, b) {
  return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
}

function hint(thread) {
  if (thread.status === 'open') return thread.last || 'Open';
  return HINT[thread.status] || thread.status;
}

function lines(messages) {
  if (!messages.length) return '';
  return `<div class="chat-log" role="log" aria-label="Messages">${messages.map((entry) => `<p class="chat-line${entry.yours ? ' yours' : ''}"><span>${esc(entry.text)}</span> <span class="muted">${esc(formatDate(entry.at))}</span></p>`).join('')}</div>`;
}

function railHtml(threads, activeName) {
  const people = threads.map((thread) => {
    const current = sameUser(thread.username, activeName) ? ' aria-current="page"' : '';
    return `<a href="#/messages/${encodeURIComponent(thread.username)}"${current}><span class="msg-name">${esc(thread.username)}</span><span class="msg-preview">${esc(hint(thread))}</span></a>`;
  }).join('');
  const fresh = activeName ? '' : ' aria-current="page"';
  return `<nav class="msg-rail" aria-label="Conversations"><a class="msg-new" href="#/messages"${fresh}><span class="msg-name">New message</span></a>${people}</nav>`;
}

function composeForm(username) {
  const who = username
    ? ''
    : `<label for="message-name">Username</label><input id="message-name" class="field" name="username" maxlength="24" spellcheck="false" autocomplete="off" required>`;
  const label = username ? 'Send a request' : 'Send';
  return `<form class="follow-form" aria-label="Send a message">${who}<label for="message-text">Message</label><textarea id="message-text" class="field" name="text" maxlength="500" required></textarea><button class="btn primary" type="submit">${label}</button></form>`;
}

function paneHtml(active) {
  if (!active) {
    return `<h2>New message</h2>${composeForm('')}<p class="appeal-status" role="status"></p>`;
  }
  if (active.error) {
    return `<h2>${esc(active.username)}</h2><p role="alert">${esc(active.error)}</p>`;
  }
  const name = active.username;
  let extra = '';
  if (active.status === 'incoming') {
    extra = `<p class="help">${esc(name)} asked to exchange messages.</p><div class="btn-row"><button class="btn" type="button" data-act="accept">Accept</button><button class="btn" type="button" data-act="decline">Decline</button></div>`;
  } else if (active.status === 'outgoing') {
    extra = `<p class="help">You asked ${esc(name)} to exchange messages. Waiting for a reply.</p>`;
  } else if (active.status === 'declined') {
    extra = '<p class="help">This player has declined messages.</p>';
  } else if (active.status === 'open') {
    extra = `<form class="chat-form" aria-label="Reply"><label class="visually-hidden" for="reply-text">Message</label><textarea id="reply-text" class="field" name="text" maxlength="500" required></textarea><button class="btn primary" type="submit">Send</button></form>`;
  } else {
    extra = `<p class="help">This is the first message to ${esc(name)}. They accept it before the conversation continues.</p>${composeForm(name)}`;
  }
  return `<h2>${esc(name)}</h2>${lines(active.messages || [])}${extra}<p class="appeal-status" role="status"></p>`;
}

function paint(root, account, threads, active) {
  const activeName = active && active.username ? active.username : '';
  const listed = threads.slice();
  if (active && !active.error && activeName && !listed.some((thread) => sameUser(thread.username, activeName))) {
    listed.unshift({ username: activeName, status: active.status || 'none', last: '' });
  }
  root.innerHTML = `
    <h1 class="page-title" id="title-messages">Messages</h1>
    <p class="lede">Choose a player on the left, or start a new message.</p>
    <div class="msg-layout">
      ${railHtml(listed, activeName)}
      <div class="msg-pane">${paneHtml(active)}</div>
    </div>`;
  const log = root.querySelector('.chat-log');
  if (log) log.scrollTop = log.scrollHeight;
  const status = root.querySelector('.appeal-status');
  const form = root.querySelector('form');
  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('button');
      const username = activeName || form.username.value.trim();
      button.disabled = true;
      status.textContent = 'The message is being sent.';
      try {
        await api(`/api/messages/${encodeURIComponent(username)}`, { method: 'POST', token: account.token, body: { text: form.text.value } });
        if (!activeName) {
          location.hash = `#/messages/${encodeURIComponent(username)}`;
          return;
        }
        if (root.isConnected) await render(root, { rest: [username] });
      } catch (err) {
        button.disabled = false;
        status.textContent = err.message;
      }
    });
  }
  root.querySelectorAll('[data-act]').forEach((button) => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      status.textContent = button.dataset.act === 'accept' ? 'The request is being accepted.' : 'The request is being declined.';
      try {
        await api(`/api/messages/${encodeURIComponent(activeName)}/${button.dataset.act}`, { method: 'POST', token: account.token });
        if (root.isConnected) await render(root, { rest: [activeName] });
      } catch (err) {
        button.disabled = false;
        status.textContent = err.message;
      }
    });
  });
}

export async function render(root, { rest } = {}) {
  const token = ++generation;
  const account = readAccount();
  const requested = rest && rest[0] ? decodeURIComponent(rest[0]) : '';
  if (!account) {
    root.innerHTML = `
      <h1 class="page-title" id="title-messages">Messages</h1>
      <p><a href="#/account">Sign in</a> to send a message.</p>`;
    return;
  }
  root.innerHTML = `
    <h1 class="page-title" id="title-messages">Messages</h1>
    <p class="lede">Choose a player on the left, or start a new message.</p>
    <p class="muted" role="status">The messages are loading.</p>`;
  let inbox;
  try {
    inbox = await api('/api/messages', { token: account.token });
  } catch (err) {
    if (token !== generation || !root.isConnected) return;
    root.innerHTML = `<h1 class="page-title" id="title-messages">Messages</h1><p role="alert">${esc(err.message)}</p>`;
    return;
  }
  if (token !== generation || !root.isConnected) return;
  let active = null;
  if (requested) {
    try {
      active = await api(`/api/messages/${encodeURIComponent(requested)}`, { token: account.token });
    } catch (err) {
      active = { username: requested, error: err.message };
    }
  }
  if (token !== generation || !root.isConnected) return;
  if (active && !active.error && Array.isArray(active.messages) && active.messages.length) {
    const newest = active.messages[active.messages.length - 1];
    if (newest && Number.isFinite(newest.at)) markThreadSeen(active.username, newest.at);
  }
  noteInbox(inbox.threads || []);
  paint(root, account, inbox.threads || [], active);
}
