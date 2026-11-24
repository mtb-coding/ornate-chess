// Home page: introduction, page directory, progress summary.
import { mods } from './modules.js';
import { settings, difficulty } from './state.js';
import { esc, formatDate } from './dom.js';
import { CORNER, DIVIDER } from './ornament.js';
import { pieceSvg } from './pieces.js';
import { ratingPanelHtml } from './rating-view.js';
import { refreshOnlineRatings } from './online-ratings-client.js';
import { ENDGAMES } from '../data/endgames.js';

const fc = `<span class="fc tl">${CORNER}</span><span class="fc tr">${CORNER}</span><span class="fc bl">${CORNER}</span><span class="fc br">${CORNER}</span>`;

const CARDS = [
  { href: '#/play', piece: ['w', 'k'], title: 'Play', text: 'Play another person at a time control, or play the bot on this device.' },
  { href: '#/local', piece: ['b', 'q'], title: 'Two players', text: 'Play a game with another person on this device, with an optional clock.' },
  { href: '#/puzzles', piece: ['w', 'n'], title: 'Puzzles', text: 'Solve tactical positions, from mates in one move to endgame techniques.' },
  { href: '#/puzzles/generated', piece: ['b', 'n'], title: 'Generated puzzles', text: 'Solve new puzzles that this device creates on request at an easy, medium or hard level.' },
  { href: '#/openings', piece: ['w', 'b'], title: 'Opening library', text: 'Browse more than one hundred named openings, step through their moves and practise them.' },
  { href: '#/endgames', piece: ['b', 'k'], title: 'Endgame practice', text: 'Practise essential endgame positions against the engine, from the basic checkmates to the Lucena, Philidor and Vancura rook endings.' },
  { href: '#/stats', piece: ['w', 'p'], title: 'Progress statistics', text: 'Review your bullet, blitz and rapid ratings, your results, your puzzle accuracy, and the endgame positions you have completed.' },
  { href: '#/analysis', piece: ['b', 'b'], title: 'Analysis', text: 'Load a game, a PGN text or a FEN position and study it with the engine.' },
  { href: '#/saved', piece: ['w', 'r'], title: 'Saved games', text: 'Load, rename, delete, import and export the games stored on this device.' },
  { href: '#/account', piece: ['w', 'q'], title: 'Account', text: 'Sign in to keep saved games and progress on the account server. The application still works when that server is turned off.' },
  { href: '#/learn', piece: ['b', 'p'], title: 'Learn', text: 'Read a summary of the rules, a guide to chess notation and the keyboard shortcuts.' },
];

export async function render(root) {
  const s = settings();
  const st = mods.storage;
  const auto = st.loadAutosave();
  const stats = st.getStats() || {};
  const totals = stats.totals || { wins: 0, losses: 0, draws: 0, games: 0 };
  const rating = st.getRating();
  const prog = st.getPuzzleProgress() || {};
  const solved = Object.values(prog.puzzles || {}).filter((p) => p.solved).length;
  const total = (mods.puzzleData.PUZZLES || []).length;
  const resumable = auto && auto.game && auto.game.uci && auto.game.uci.length && !auto.game.resultInfo;
  const games = st.listGames();
  const onlineRatings = await refreshOnlineRatings();
  let endgameDone = 0;
  try {
    const eg = st.getEndgameProgress ? st.getEndgameProgress() : { positions: {} };
    endgameDone = Object.values(eg.positions || {}).filter((p) => p && p.completed).length;
  } catch { endgameDone = 0; }

  root.innerHTML = `
    <div class="frame hero">${fc}<div class="frame-inner">
      <h1 class="page-title" id="title-home">Welcome to Ornate Chess</h1>
      <p class="lede">This application offers games against an adjustable bot, games between two people, a collection of puzzles, generated puzzles, puzzles drawn from your own mistakes, an opening library, endgame practice, a post-game review, an analysis board, a library of saved games, and a page of progress statistics. Everything runs in this browser and works without a network connection.</p>
      <div class="hero-pieces" aria-hidden="true">${['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'].map((t, i) => `<span>${pieceSvg(s.pieceSet, i % 2 ? 'b' : 'w', t)}</span>`).join('')}</div>
      <div class="btn-row center">
        ${resumable ? `<a class="btn primary" href="${auto.mode === 'local' ? '#/local' : '#/play?bot=1'}">Resume the game in progress</a>` : `<a class="btn primary" href="#/play">Play</a>`}
        <a class="btn" href="#/puzzles">Solve a puzzle</a>
      </div>
    </div></div>
    ${DIVIDER}
    <section class="frame rating-panel" aria-labelledby="rating-title">${fc}<div class="frame-inner">${ratingPanelHtml(onlineRatings)}</div></section>
    ${DIVIDER}
    <nav class="card-grid" aria-label="Sections">
      ${CARDS.map((c) => `<a class="card frame tight" href="${c.href}">${fc}<span class="frame-inner card-inner"><span class="card-piece" aria-hidden="true">${pieceSvg(s.pieceSet, c.piece[0], c.piece[1])}</span>
        <span class="card-title">${esc(c.title)}</span><span class="card-text">${esc(c.text)}</span></span></a>`).join('')}
    </nav>
    ${DIVIDER}
    <div class="frame summary">${fc}<div class="frame-inner">
      <h2>Your progress</h2>
      <dl class="stat-grid">
        <div><dt>Games against the bot</dt><dd>${totals.games || 0}</dd></div>
        <div><dt>Wins, losses and draws</dt><dd>${totals.wins || 0} / ${totals.losses || 0} / ${totals.draws || 0}</dd></div>
        <div><dt>Puzzle rating</dt><dd>${Math.round(rating)}</dd></div>
        <div><dt>Puzzles solved</dt><dd>${solved} of ${total}</dd></div>
        <div><dt>Saved games</dt><dd>${games.length}</dd></div>
        <div><dt>Endgames completed</dt><dd>${endgameDone} of ${ENDGAMES.length}</dd></div>
        <div><dt>Default bot level</dt><dd>${esc(difficulty(s.lastBotLevel).name)}</dd></div>
      </dl>
      <p class="muted">A fuller record of your bullet, blitz and rapid ratings, results, puzzle accuracy and endgame completion is on the <a href="#/stats">statistics page</a>.</p>
      ${resumable ? `<p class="muted">A game in progress was saved automatically on ${esc(formatDate(auto.savedAt))}.</p>` : ''}
    </div></div>`;
}
