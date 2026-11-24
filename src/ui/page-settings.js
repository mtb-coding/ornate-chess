// Settings: theme, piece set, board style, sound and display toggles.
import { settings, updateSettings } from './state.js';
import { esc, toast } from './dom.js';
import { CORNER, DIVIDER } from './ornament.js';
import { PIECE_SETS, pieceSvg } from './pieces.js';
import { play as sfx } from './sound.js';
import { RATING_DISCLAIMER } from './rating-view.js';
import { formatGlicko } from '../glicko.js';
import { PACE_LABEL, PACES } from '../online-ratings.js';
import { refreshOnlineRatings } from './online-ratings-client.js';

function ratingSummary(doc) {
  return PACES.map((pace) => {
    const record = doc[pace];
    const name = PACE_LABEL[pace];
    const shown = formatGlicko(record.rating, record.deviation);
    const games = record.games;
    return `${name} is ${shown} after ${games} rated ${games === 1 ? 'game' : 'games'}.`;
  }).join(' ');
}

const fc = `<span class="fc tl">${CORNER}</span><span class="fc tr">${CORNER}</span><span class="fc bl">${CORNER}</span><span class="fc br">${CORNER}</span>`;
const THEMES = [['ebony', 'Ebony'], ['ivory', 'Ivory'], ['emerald', 'Emerald'], ['sapphire', 'Sapphire']];
const BOARDS = [['marble', 'Marble'], ['walnut', 'Walnut']];
const TOGGLES = [
  ['sound', 'Play sound effects.', 'The sounds are generated in the browser when moves are played. On an iPhone, the sounds are muted while the ring and silent switch is set to silent.'],
  ['showLegal', 'Show legal moves.', 'Dots mark the squares that the selected piece can move to.'],
  ['showCoords', 'Show coordinates around the board.', 'Files and ranks are printed in the board frame.'],
  ['animations', 'Animate piece movement.', 'Pieces slide to their new squares. The system setting for reduced motion is respected.'],
  ['autoQueen', 'Promote to a queen automatically.', 'When this is off, a dialog asks which piece the pawn becomes.'],
  ['hints', 'Offer hints in games against the bot.', 'A Hint button appears in the game controls.'],
  ['showEval', 'Show the evaluation bar during games.', 'The bar shows which side the engine prefers. It is always shown on the Analysis page.'],
];

export async function render(root) {
  const s = settings();
  const ratings = await refreshOnlineRatings();
  const radio = (name, value, label, extra = '') => `<label class="choice"><input type="radio" name="${name}" value="${value}" ${s[name] === value ? 'checked' : ''}><span>${extra}${esc(label)}</span></label>`;
  root.innerHTML = `
    <h1 class="page-title" id="title-settings">Settings</h1>
    <p class="lede">Changes are applied immediately and stored on this device.</p>
    <form class="settings-grid" aria-label="Settings">
      <div class="frame">${fc}<div class="frame-inner">
        <h2>Appearance</h2>${DIVIDER}
        <fieldset><legend>Theme</legend><div class="choice-row">${THEMES.map(([v, l]) => radio('theme', v, l, `<span class="swatch sw-${v}" aria-hidden="true"></span>`)).join('')}</div></fieldset>
        <fieldset><legend>Board style</legend><div class="choice-row">${BOARDS.map(([v, l]) => radio('boardStyle', v, l, `<span class="swatch sw-${v}" aria-hidden="true"></span>`)).join('')}</div></fieldset>
        <fieldset><legend>Piece set</legend><div class="choice-row">${Object.entries(PIECE_SETS).map(([v, set]) => radio('pieceSet', v, set.name, `<span class="set-preview" aria-hidden="true">${pieceSvg(v, 'w', 'n')}${pieceSvg(v, 'b', 'q')}</span>`)).join('')}</div></fieldset>
      </div></div>
      <div class="frame">${fc}<div class="frame-inner">
        <h2>Play and display</h2>${DIVIDER}
        ${TOGGLES.map(([k, l, h]) => `<label class="toggle"><input type="checkbox" name="${k}" ${s[k] ? 'checked' : ''}><span>${esc(l)}<span class="help">${esc(h)}</span></span></label>`).join('')}
        <div class="btn-row"><button class="btn" type="button" data-act="test-sound">Play a test sound</button><button class="btn danger" type="button" data-act="reset">Restore the default settings</button></div>
      </div></div>
      <div class="frame">${fc}<div class="frame-inner">
        <h2>Online ratings</h2>${DIVIDER}
        <p class="rating-summary">${esc(ratingSummary(ratings))}</p>
        <p class="help">${esc(RATING_DISCLAIMER)}</p>
        <p class="help">The server updates a rating when an online game of that category finishes. It cannot be reset from this page.</p>
      </div></div>
    </form>`;
  const form = root.querySelector('form');
  form.addEventListener('change', (e) => {
    const t = e.target;
    const patch = t.type === 'checkbox' ? { [t.name]: t.checked } : { [t.name]: t.value };
    updateSettings(patch);
    if (t.name === 'sound' && t.checked) sfx('move');
  });
  form.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'test-sound') { if (settings().sound) sfx('check'); else toast('Sound effects are turned off.'); }
    if (b.dataset.act === 'reset') {
      const defaults = { theme: 'ebony', pieceSet: 'classic', boardStyle: 'marble', sound: true, showLegal: true, showCoords: true, autoQueen: false, animations: true, hints: true, showEval: false, boardPerspective: 'auto' };
      updateSettings(defaults); render(root); toast('The default settings were restored.');
    }
  });
}
