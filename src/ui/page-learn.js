// Learn and About: rules summary, notation guide and keyboard shortcuts.
import { esc } from './dom.js';
import { CORNER, DIVIDER } from './ornament.js';
import { pieceSvg } from './pieces.js';
import { settings } from './state.js';
import { SHORTCUTS, ANNOTATION_HELP } from './shortcuts.js';

const fc = `<span class="fc tl">${CORNER}</span><span class="fc tr">${CORNER}</span><span class="fc bl">${CORNER}</span><span class="fc br">${CORNER}</span>`;
const PIECES = [
  ['k', 'King', 'The king moves one square in any direction. It may never move to a square that is attacked.'],
  ['q', 'Queen', 'The queen moves any number of squares along a rank, a file or a diagonal.'],
  ['r', 'Rook', 'The rook moves any number of squares along a rank or a file.'],
  ['b', 'Bishop', 'The bishop moves any number of squares along a diagonal, so it always stays on squares of one colour.'],
  ['n', 'Knight', 'The knight moves two squares in one direction and then one square at a right angle. It is the only piece that jumps over others.'],
  ['p', 'Pawn', 'The pawn moves one square forward, or two squares from its starting square. It captures one square diagonally forward.'],
];

export function render(root) {
  const set = settings().pieceSet;
  root.innerHTML = `
    <h1 class="page-title" id="title-learn">Learn and about</h1>
    <p class="lede">This page summarises the rules of chess, explains the notation used in the move list, and lists the keyboard shortcuts.</p>
    <div class="learn-grid">
      <article class="frame">${fc}<div class="frame-inner">
        <h2>How the pieces move</h2>${DIVIDER}
        <ul class="piece-rules">${PIECES.map(([t, n, d]) => `<li><span class="rule-piece" aria-hidden="true">${pieceSvg(set, 'w', t)}</span><div><h3 class="small">${n}</h3><p>${esc(d)}</p></div></li>`).join('')}</ul>
      </div></article>
      <article class="frame">${fc}<div class="frame-inner">
        <h2>Special rules</h2>${DIVIDER}
        <h3 class="small">Castling</h3><p>The king moves two squares towards a rook, and the rook moves to the square the king crossed. Castling is allowed only if neither piece has moved, the squares between them are empty, and the king is not in check and does not cross or land on an attacked square.</p>
        <h3 class="small">En passant</h3><p>When a pawn advances two squares and lands beside an enemy pawn, the enemy pawn may capture it as if it had moved one square. This capture is allowed only on the next move.</p>
        <h3 class="small">Promotion</h3><p>A pawn that reaches the last rank becomes a queen, rook, bishop or knight of the same colour.</p>
        <h3 class="small">End of the game</h3><p>A player who is in check and has no legal move is checkmated and loses. A player who is not in check and has no legal move is stalemated, and the game is drawn. In this application the game is also drawn automatically on threefold repetition, under the fifty-move rule, and when neither side has enough material to checkmate. A player may also resign, agree a draw, or lose on time when a clock is used.</p>
      </div></article>
      <article class="frame">${fc}<div class="frame-inner">
        <h2>Reading chess notation</h2>${DIVIDER}
        <p>The move list uses standard algebraic notation (SAN). Files are labelled a to h from White's left, and ranks are numbered 1 to 8 from White's side.</p>
        <table class="notation-table"><thead><tr><th scope="col">Notation</th><th scope="col">Meaning</th></tr></thead><tbody>
          <tr><td>e4</td><td>A pawn moves to e4.</td></tr>
          <tr><td>Nf3</td><td>A knight moves to f3. The letters K, Q, R, B and N stand for king, queen, rook, bishop and knight.</td></tr>
          <tr><td>Bxe5</td><td>A bishop captures on e5. The letter x marks a capture.</td></tr>
          <tr><td>exd5</td><td>The pawn on the e-file captures on d5.</td></tr>
          <tr><td>Nbd2</td><td>The knight on the b-file moves to d2. The extra letter shows which of two knights moved.</td></tr>
          <tr><td>O-O and O-O-O</td><td>Castling on the king side and on the queen side.</td></tr>
          <tr><td>e8=Q</td><td>A pawn promotes to a queen on e8.</td></tr>
          <tr><td>+ and #</td><td>The move gives check, or the move gives checkmate.</td></tr>
          <tr><td>1-0, 0-1, 1/2-1/2</td><td>White won, Black won, or the game was drawn.</td></tr>
        </tbody></table>
        <p>PGN (Portable Game Notation) is a text format that stores the moves together with information such as the players and the result. FEN (Forsyth-Edwards Notation) is a single line of text that describes one position.</p>
      </div></article>
      <article class="frame" id="shortcuts">${fc}<div class="frame-inner">
        <h2>Keyboard shortcuts</h2>${DIVIDER}
        <table class="shortcut-table"><tbody>${SHORTCUTS.map(([k, d]) => `<tr><th scope="row">${esc(k)}</th><td>${esc(d)}</td></tr>`).join('')}</tbody></table>
        <p class="annot-help">${esc(ANNOTATION_HELP)}</p>
        <p>Every control can be reached with the Tab key. On the board, each square announces its name and contents to screen readers.</p>
      </div></article>
      <article class="frame learn-span">${fc}<div class="frame-inner">
        <h2>About this application</h2>${DIVIDER}
        <p>Ornate Chess is a static web application written in plain JavaScript modules. The rules engine, the bot, the puzzle collection and the storage layer are separate modules. The bot searches in a background worker so that the page remains responsive while it calculates.</p>
        <p>The bot has eight levels, from Novice to Grandmaster. The approximate ratings are estimates and are not official ratings. The pieces, frames and ornaments are drawn with inline SVG, and the sound effects are synthesised by the browser, so the application needs no downloads after it loads.</p>
      </div></article>
    </div>`;
}
