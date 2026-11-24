// Ornate Chess application entry: loads modules, builds the shell and runs
// the hash router.
import { loadModules, mods, stubsInUse } from './ui/modules.js';
import { app, settings } from './ui/state.js';
import { CARTOUCHE_BG, CROWN_EMBLEM, DIVIDER, CORNER, ICONS } from './ui/ornament.js';
import { SHORTCUTS, ANNOTATION_HELP } from './ui/shortcuts.js';
import { PIECE_DEFS } from './ui/pieces.js';
import { setSoundEnabled } from './ui/sound.js';
import { onSettings } from './ui/state.js';
import { $, $$, esc } from './ui/dom.js';
import { footerText, readAccount, syncNow, watchAccountChanges } from './ui/account-client.js';

const ROUTES = [
  { id: 'home', label: 'Home', title: 'Home', pin: true, load: () => import('./ui/page-home.js') },
  { id: 'play', label: 'Play', title: 'Play', pin: true, load: () => import('./ui/page-play.js') },
  { id: 'local', label: 'Two players', title: 'Two-player game', pin: true, load: () => import('./ui/page-local.js') },
  { id: 'puzzles', label: 'Puzzles', title: 'Puzzles', pin: true, load: () => import('./ui/page-puzzles.js') },
  { id: 'openings', label: 'Openings', title: 'Opening library', load: () => import('./ui/page-openings.js') },
  { id: 'endgames', label: 'Endgames', title: 'Endgame practice', load: () => import('./ui/page-endgames.js') },
  { id: 'stats', label: 'Stats', title: 'Progress statistics', load: () => import('./ui/page-stats.js') },
  { id: 'saved', label: 'Saved games', title: 'Saved games', load: () => import('./ui/page-saved.js') },
  { id: 'analysis', label: 'Analysis', title: 'Analysis', load: () => import('./ui/page-analysis.js') },
  { id: 'review', label: 'Review', title: 'Game review', load: () => import('./ui/page-review.js'), nav: false },
  { id: 'account', label: 'Account', title: 'Account', pin: true, load: () => import('./ui/page-account.js') },
  { id: 'settings', label: 'Settings', title: 'Settings', pin: true, load: () => import('./ui/page-settings.js') },
  { id: 'learn', label: 'Learn', title: 'Learn and about', load: () => import('./ui/page-learn.js') },
];

let current = null; // { id, mod, cleanup }
let navToken = 0;

function applySettings(s) {
  document.documentElement.dataset.theme = s.theme || 'ebony';
  document.documentElement.dataset.board = s.boardStyle || 'marble';
  setSoundEnabled(s.sound !== false);
}

function navLink(route) {
  const href = route.id === 'home' ? '#/' : `#/${route.id}`;
  return `<li><a href="${href}" data-route="${route.id}">${esc(route.label)}</a></li>`;
}

function buildShell() {
  document.body.insertAdjacentHTML('afterbegin', PIECE_DEFS);
  const pinned = ROUTES.filter((route) => route.pin);
  const more = ROUTES.filter((route) => route.nav !== false && !route.pin);
  $('#site-header').innerHTML = `
    <div class="header-top">
      <div class="menu-anchor">
        <button type="button" class="nav-toggle btn icon-only" id="nav-toggle" aria-expanded="false" aria-controls="main-nav-list" aria-label="More pages">${ICONS.menu}</button>
        <nav class="more-nav" id="site-nav" aria-label="More pages"><ul id="main-nav-list">${more.map(navLink).join('')}</ul></nav>
      </div>
      <a class="cartouche" href="#/" aria-label="Ornate Chess, home page">${CARTOUCHE_BG}${CROWN_EMBLEM}
        <span class="cartouche-text"><span class="cartouche-title">Ornate Chess</span><span class="cartouche-sub">A game of kings</span></span></a>
      <span class="header-spacer" aria-hidden="true"></span>
    </div>
    <nav class="main-nav primary-nav" aria-label="Main"><ul>${pinned.map(navLink).join('')}</ul></nav>`;
  $('#site-footer').innerHTML = `${DIVIDER}
    <p id="footer-note">${esc(footerText(readAccount()))}</p>
    <p class="footer-shortcuts">Press <kbd>?</kbd> to see the keyboard shortcuts.</p>
    ${stubsInUse.length ? `<p class="footer-warn">Development stubs are active for: ${esc(stubsInUse.join(', '))}. Some features are limited.</p>` : ''}`;
  const toggle = $('#nav-toggle');
  const nav = $('#site-nav');
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? 'Close the menu' : 'More pages');
  });
  nav.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('a')) closeNav(); });
  document.addEventListener('click', (e) => {
    if (!nav.classList.contains('is-open')) return;
    if (nav.contains(e.target) || toggle.contains(e.target)) return;
    closeNav();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeNav(); });
}

function closeNav() {
  const nav = $('#site-nav');
  const toggle = $('#nav-toggle');
  if (!nav || !toggle) return;
  nav.classList.remove('is-open');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-label', 'More pages');
}

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = h.split('?');
  const parts = path.split('/').filter(Boolean);
  const id = parts[0] || 'home';
  return { id, rest: parts.slice(1), query: new URLSearchParams(query) };
}

async function navigate() {
  const token = ++navToken;
  const { id, rest, query } = parseHash();
  const route = ROUTES.find((r) => r.id === id) || ROUTES[0];
  if (current && current.cleanup) { try { current.cleanup(); } catch (err) { console.error(err); } }
  current = null;
  const main = $('#main');
  let mod;
  try { mod = await route.load(); } catch (err) {
    console.error(err);
    main.innerHTML = `<section class="page"><h1 class="page-title">The page could not be loaded</h1><p class="lede">${esc(err.message)}</p></section>`;
    return;
  }
  if (token !== navToken) return;
  main.innerHTML = '';
  const section = document.createElement('section');
  section.className = `page page-${route.id}`;
  section.setAttribute('aria-labelledby', `title-${route.id}`);
  main.appendChild(section);
  let cleanup = null;
  try { cleanup = await mod.render(section, { rest, query, routeId: route.id }); } catch (err) {
    console.error(err);
    section.innerHTML = `<h1 class="page-title" id="title-${route.id}">The page could not be shown</h1><p class="lede">${esc(err.message)}</p>`;
  }
  if (token !== navToken) { if (cleanup) cleanup(); return; }
  closeNav();
  current = { id: route.id, mod, cleanup };
  document.title = `${route.title} | Ornate Chess`;
  $$('.main-nav a, .more-nav a').forEach((a) => { if (a.dataset.route === route.id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  const h = section.querySelector('h1');
  if (h && app.navigated) { h.tabIndex = -1; h.focus({ preventScroll: true }); window.scrollTo({ top: 0 }); }
  app.navigated = true;
  window.__chess.page = route.id;
  window.__chess.ready = true;
}

function shortcutsDialog() {
  const rows = SHORTCUTS.map(([k, d]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(d)}</td></tr>`).join('');
  const dlg = document.createElement('dialog');
  dlg.className = 'ornate-dialog wide';
  dlg.setAttribute('aria-labelledby', 'sc-title');
  dlg.innerHTML = `<div class="frame dialog-frame"><span class="fc tl">${CORNER}</span><span class="fc tr">${CORNER}</span><span class="fc bl">${CORNER}</span><span class="fc br">${CORNER}</span><div class="frame-inner"><h2 class="engraved" id="sc-title">Keyboard shortcuts</h2>${DIVIDER}<table class="shortcut-table"><tbody>${rows}</tbody></table><p class="annot-help">${esc(ANNOTATION_HELP)}</p><div class="dialog-actions"><button class="btn primary" type="button">Close</button></div></div></div>`;
  document.body.appendChild(dlg);
  dlg.querySelector('button').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
  dlg.querySelector('button').focus();
}

function onKey(e) {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  if (t.closest && (t.closest('input, textarea, select, [contenteditable="true"], dialog'))) return;
  if (document.querySelector('dialog[open]')) return;
  if (e.key === '?') { e.preventDefault(); shortcutsDialog(); return; }
  if (current && current.mod.onKey && current.mod.onKey(e)) e.preventDefault();
}

async function start() {
  window.__chess = { ready: false, page: null, stubs: stubsInUse, app };
  await loadModules();
  window.__chess.mods = mods;
  applySettings(settings());
  onSettings(applySettings);
  buildShell();
  watchAccountChanges();
  window.addEventListener('hashchange', navigate);
  document.addEventListener('keydown', onKey);
  await navigate();
  const REFRESH_AFTER_SYNC = new Set(['home', 'stats', 'saved', 'puzzles', 'endgames', 'settings', 'openings']);
  void syncNow().then((result) => {
    if (!result || !result.ok || !result.applied) return;
    if (REFRESH_AFTER_SYNC.has(window.__chess && window.__chess.page)) navigate();
  }).catch(() => { /* The account page reports sync failures. */ });
  if ('serviceWorker' in navigator) {
    try { await navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href); } catch (err) { console.warn('The service worker was not registered.', err); }
  }
}

start().catch((err) => {
  console.error(err);
  document.getElementById('main').innerHTML = `<p class="lede">The application could not start: ${esc(err.message)}</p>`;
});
