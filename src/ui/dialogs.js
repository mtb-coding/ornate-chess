// Modal dialogs built on the native <dialog> element so focus trapping,
// Escape handling and the top layer come from the browser.
import { esc } from './dom.js';
import { CORNER, DIVIDER } from './ornament.js';
import { pieceSvg, PIECE_NAMES } from './pieces.js';

function shell(title, bodyHtml, actionsHtml, { labelId = 'dlg-title-' + Math.random().toString(36).slice(2, 7), cls = '' } = {}) {
  const d = document.createElement('dialog');
  d.className = 'ornate-dialog ' + cls;
  d.setAttribute('aria-labelledby', labelId);
  d.innerHTML = `<div class="frame dialog-frame"><span class="fc tl">${CORNER}</span><span class="fc tr">${CORNER}</span><span class="fc bl">${CORNER}</span><span class="fc br">${CORNER}</span>
  <div class="frame-inner"><h2 class="engraved" id="${labelId}">${esc(title)}</h2>${DIVIDER}<div class="dialog-body">${bodyHtml}</div><div class="dialog-actions">${actionsHtml}</div></div></div>`;
  document.body.appendChild(d);
  return d;
}

function run(d, { onReturn, initialFocus } = {}) {
  return new Promise((resolve) => {
    let value = null;
    d.addEventListener('click', (e) => {
      const b = e.target.closest('[data-value]');
      if (b && d.contains(b)) { value = b.dataset.value; d.close(value); }
    });
    d.addEventListener('close', () => {
      const v = onReturn ? onReturn(d, value) : value;
      d.remove();
      resolve(v);
    });
    d.showModal();
    const f = initialFocus ? d.querySelector(initialFocus) : d.querySelector('[autofocus], .btn.primary, button');
    if (f) f.focus();
  });
}

/** Returns 'ok', 'cancel', or null when the dialog is dismissed. */
export function choiceDialog(title, message, { ok = 'Confirm', cancel = 'Cancel', danger = false } = {}) {
  const d = shell(title, `<p>${esc(message)}</p>`,
    `<button class="btn" data-value="cancel" type="button">${esc(cancel)}</button><button class="btn primary ${danger ? 'danger' : ''}" data-value="ok" type="button">${esc(ok)}</button>`);
  return run(d);
}

export function confirmDialog(title, message, { ok = 'Confirm', cancel = 'Cancel', danger = false } = {}) {
  const d = shell(title, `<p>${esc(message)}</p>`,
    `<button class="btn" data-value="cancel" type="button">${esc(cancel)}</button><button class="btn primary ${danger ? 'danger' : ''}" data-value="ok" type="button">${esc(ok)}</button>`);
  return run(d).then((v) => v === 'ok');
}

export function alertDialog(title, message, { ok = 'Close' } = {}) {
  const d = shell(title, `<p>${esc(message)}</p>`, `<button class="btn primary" data-value="ok" type="button">${esc(ok)}</button>`);
  return run(d);
}

export function promptDialog(title, label, value = '', { ok = 'Save', multiline = false } = {}) {
  const id = 'pr-' + Math.random().toString(36).slice(2, 7);
  const input = multiline
    ? `<textarea id="${id}" class="field" rows="8" spellcheck="false">${esc(value)}</textarea>`
    : `<input id="${id}" class="field" type="text" value="${esc(value)}" maxlength="80" autocomplete="off">`;
  const d = shell(title, `<form method="dialog" class="prompt-form"><label for="${id}">${esc(label)}</label>${input}</form>`,
    `<button class="btn" data-value="cancel" type="button">Cancel</button><button class="btn primary" data-value="ok" type="button">${esc(ok)}</button>`);
  const form = d.querySelector('form');
  form.addEventListener('submit', (e) => { e.preventDefault(); d.close('ok'); });
  return run(d, {
    initialFocus: '#' + id,
    onReturn: (dlg, v) => (v === 'ok' || dlg.returnValue === 'ok' ? dlg.querySelector('#' + id).value : null),
  });
}

export function promotionDialog(color, pieceSet) {
  const opts = ['q', 'r', 'b', 'n'].map((t) => `<button type="button" class="promo-btn" data-value="${t}" aria-label="Promote to ${PIECE_NAMES[t]}">${pieceSvg(pieceSet, color, t)}<span>${PIECE_NAMES[t][0].toUpperCase() + PIECE_NAMES[t].slice(1)}</span></button>`).join('');
  const d = shell('Choose a promotion piece', `<p>Select the piece that the pawn becomes.</p><div class="promo-grid">${opts}</div>`,
    `<button class="btn" data-value="cancel" type="button">Cancel the move</button>`, { cls: 'promo-dialog' });
  return run(d, { initialFocus: '.promo-btn' }).then((v) => (v && v !== 'cancel' ? v : null));
}

export function gameOverDialog(title, message, actions, { extraHtml = '' } = {}) {
  const btns = actions.map((a, i) => `<button class="btn ${i === 0 ? 'primary' : ''}" data-value="${esc(a.value)}" type="button">${esc(a.label)}</button>`).join('');
  const d = shell(title, `<p class="result-text">${esc(message)}</p>${extraHtml ? `<div class="gameover-rating">${extraHtml}</div>` : ''}`, btns, { cls: 'gameover-dialog' });
  return run(d);
}
