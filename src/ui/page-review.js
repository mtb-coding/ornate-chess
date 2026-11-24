// Post-game review page (#/review and #/review/<saved-id>).
import { mods } from './modules.js';
import { app, difficulty } from './state.js';
import { Board } from './board.js';
import { esc, toast } from './dom.js';
import { CORNER, ICONS } from './ornament.js';
import { startReview, cancelReview, cachedReview, isReviewing, REVIEW_DEPTH } from './review-client.js';
import {
  JUDGMENTS, JUDGMENT_LABELS, FLAGGED, formatWhiteEval,
  reviewArrowsForMove, whiteCpFrom, lineEvalAtStep,
} from '../review.js';
import { badgeSvg, badgeChipHtml, BADGE_SYMBOLS } from './review-badges.js';
import { Position } from '../engine.js';
import { playReviewStep, preloadReviewSounds } from './review-sound.js';

const fc = `<span class="fc tl">${CORNER}</span><span class="fc tr">${CORNER}</span><span class="fc bl">${CORNER}</span><span class="fc br">${CORNER}</span>`;

const COUNT_ORDER = JUDGMENTS;

function recordFromSaved(id) {
  try { return mods.storage.loadGame(id); } catch { return null; }
}

function gameSummary(record, { includeName = false } = {}) {
  if (!record) return '';
  const n = (record.game && record.game.uci && record.game.uci.length) || 0;
  const moves = `${n} ${n === 1 ? 'move' : 'moves'}`;
  const res = record.game && record.game.resultInfo;
  const parts = [];
  if (includeName && record.name) parts.push(record.name);
  if (record.mode === 'bot') {
    const lvl = record.botLevel ? difficulty(record.botLevel).name : 'Bot';
    parts.push(`${lvl}, ${record.playerColor === 'b' ? 'Black' : 'White'}`);
  }
  parts.push(moves);
  if (res && res.result) parts.push(res.result);
  return parts.join(' · ');
}

function fmtAcc(v) {
  return v == null ? '—' : String(Math.round(v));
}

function destSquare(uci) {
  if (!uci || uci.length < 4) return null;
  const files = 'abcdefgh';
  const f = files.indexOf(uci[2]);
  const r = +uci[3];
  if (f < 0 || r < 1 || r > 8) return null;
  return f + (r - 1) * 8;
}

function evalBarPct(whiteCp) {
  if (whiteCp == null || !Number.isFinite(whiteCp)) return 50;
  const abs = Math.abs(whiteCp);
  if (abs >= 10000) return whiteCp > 0 ? 100 : 0;
  const cp = Math.max(-2000, Math.min(2000, whiteCp));
  return 100 / (1 + Math.exp(-cp / 250));
}

function graphSvg(review, currentPly) {
  const vals = (review.positions || []).map((p) => (typeof p.winPercent === 'number' ? p.winPercent : 50));
  const n = Math.max(1, vals.length - 1);
  const W = 640, H = 110, L = 28, R = 8, T = 8, B = 10;
  const iw = W - L - R, ih = H - T - B;
  const x = (i) => L + (n === 0 ? 0 : (i / n) * iw);
  const y = (wp) => T + (1 - (wp / 100)) * ih;
  const mid = y(50);
  let d = '';
  vals.forEach((v, i) => { d += `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `; });
  const areaTop = `M${x(0).toFixed(1)},${mid.toFixed(1)} ` + vals.map((v, i) => `L${x(i).toFixed(1)},${y(Math.max(50, v)).toFixed(1)}`).join(' ') + ` L${x(vals.length - 1).toFixed(1)},${mid.toFixed(1)} Z`;
  const areaBot = `M${x(0).toFixed(1)},${mid.toFixed(1)} ` + vals.map((v, i) => `L${x(i).toFixed(1)},${y(Math.min(50, v)).toFixed(1)}`).join(' ') + ` L${x(vals.length - 1).toFixed(1)},${mid.toFixed(1)} Z`;
  const cx = x(currentPly);
  const hits = vals.map((v, i) => {
    const x1 = i === 0 ? L : (x(i - 1) + x(i)) / 2;
    const x2 = i === vals.length - 1 ? L + iw : (x(i) + x(i + 1)) / 2;
    return `<rect class="rg-hit" data-ply="${i}" x="${x1.toFixed(1)}" y="${T}" width="${Math.max(2, x2 - x1).toFixed(1)}" height="${ih}"></rect>`;
  }).join('');
  const dots = review.moves.map((m) => {
    const i = m.ply;
    const val = vals[i];
    const flagged = FLAGGED.includes(m.judgment);
    return `<circle class="rg-dot j-${m.judgment}${flagged ? ' flagged' : ''}" data-ply="${i}" cx="${x(i).toFixed(1)}" cy="${y(val).toFixed(1)}" r="${flagged ? 3.5 : 2}"></circle>`;
  }).join('');
  return `<svg class="review-graph-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evaluation graph from White's point of view, plotted as winning chances after each half-move.">
    <rect class="rg-bg" x="${L}" y="${T}" width="${iw}" height="${ih}"></rect>
    <line class="rg-mid" x1="${L}" y1="${mid.toFixed(1)}" x2="${L + iw}" y2="${mid.toFixed(1)}"></line>
    <path class="rg-area-w" d="${areaTop}"></path>
    <path class="rg-area-b" d="${areaBot}"></path>
    <path class="rg-line" d="${d}" fill="none"></path>
    <line class="rg-cursor" data-rg-cursor x1="${cx.toFixed(1)}" y1="${T}" x2="${cx.toFixed(1)}" y2="${T + ih}"></line>
    ${dots}
    ${hits}
  </svg>`;
}

// x position of a ply on the graph, matching graphSvg's geometry.
function graphCursorX(review, ply) {
  const n = Math.max(1, ((review.positions || []).length || 1) - 1);
  return 28 + (ply / n) * (640 - 28 - 8);
}

function moveListHtml(review, viewPly) {
  const sans = review.sans || review.moves.map((m) => m.san);
  const startTurn = (review.positions[0] && review.positions[0].turn) || 'w';
  let html = '<ol class="moves review-moves">';
  let i = 0;
  let num = 1;
  const cell = (idx) => {
    const m = review.moves[idx];
    const j = m ? m.judgment : 'best';
    const symbol = BADGE_SYMBOLS[j] || '';
    return `<button type="button" class="mv j-${j}${idx + 1 === viewPly ? ' current' : ''}" data-ply="${idx + 1}" aria-label="Move ${Math.ceil((idx + 1) / 2)}, ${m && m.color === 'b' ? 'Black' : 'White'}: ${esc(sans[idx] || '')}, ${JUDGMENT_LABELS[j] || j}.">${badgeSvg(j, { className: 'review-badge-svg list' })}<span class="mv-san">${esc(sans[idx] || '')}</span><span class="mv-j">${esc(symbol)}</span></button>`;
  };
  if (startTurn === 'b' && sans.length) {
    html += `<li><span class="mvn">${num}.</span><span class="mv empty">…</span>${cell(0)}</li>`;
    i = 1; num++;
  }
  for (; i < sans.length; i += 2, num++) {
    html += `<li><span class="mvn">${num}.</span>${cell(i)}${i + 1 < sans.length ? cell(i + 1) : ''}</li>`;
  }
  html += '</ol>';
  if (!sans.length) html = '<p class="muted">No moves have been played yet, so there is nothing to review.</p>';
  return html;
}

function countsHtml(review) {
  const sides = [
    { key: 'w', name: 'White' },
    { key: 'b', name: 'Black' },
  ];
  return `<div class="review-counts">${sides.map((s) => {
    const c = (review.counts && review.counts[s.key]) || {};
    const chips = COUNT_ORDER.map((j) => {
      const n = c[j] || 0;
      if (!n) return '';
      return `<span class="review-count j-${j}" data-judgment="${j}" title="${esc(JUDGMENT_LABELS[j])}">${badgeSvg(j, { className: 'review-badge-svg count' })}<span class="n">${n}</span></span>`;
    }).join('');
    return `<div class="review-counts-side"><span class="review-counts-label">${s.name}</span>${chips || '<span class="muted">None</span>'}</div>`;
  }).join('')}</div>`;
}

function lineListHtml(line, step, startTurn) {
  if (!line || !line.san || !line.san.length) return '<p class="muted review-line-empty">No engine line is available for this move.</p>';
  let html = '<ol class="review-line-moves">';
  let i = 0;
  let num = 1;
  const startBlack = startTurn === 'b';
  const cell = (idx) => {
    const current = idx === Math.max(0, step - 1) && step > 0;
    const upcoming = step === 0 && idx === 0;
    return `<button type="button" class="review-line-ply${current || upcoming ? ' current' : ''}" data-line-step="${idx + 1}">${esc(line.san[idx])}</button>`;
  };
  if (startBlack) {
    html += `<li><span class="mvn">${num}.</span><span class="mv empty">…</span>${cell(0)}</li>`;
    i = 1; num++;
  }
  for (; i < line.san.length; i += 2, num++) {
    html += `<li><span class="mvn">${num}.</span>${cell(i)}${i + 1 < line.san.length ? cell(i + 1) : ''}</li>`;
  }
  html += '</ol>';
  return html;
}

export function render(root, { rest } = {}) {
  let record = null;
  const pending = app.pendingLoad && app.pendingLoad.target === 'review' ? app.pendingLoad : null;
  if (pending) {
    record = pending.record;
    app.pendingLoad = null;
  } else if (rest && rest[0]) {
    record = recordFromSaved(decodeURIComponent(rest[0]));
  }
  if (app.pendingReview) {
    if (!record) record = app.pendingReview;
  }
  app.pendingReview = record || null;

  const startMs = { t: 0 };
  let review = record ? cachedReview(record, REVIEW_DEPTH) : null;
  let viewPly = review ? review.uci.length : 0;
  let board = null;
  let running = false;
  let elapsedTimer = null;
  let showArrows = true;
  let showInfo = false;
  let explain = null; // { kind: 'best'|'reply', ply, step }
  const cleanups = [];

  function maxPly() {
    return review ? review.uci.length : 0;
  }

  function currentMove() {
    if (!review || viewPly <= 0) return null;
    return review.moves[viewPly - 1] || null;
  }

  function selectedLine() {
    const move = explain ? review.moves[explain.ply - 1] : currentMove();
    if (!move) return { line: null, startTurn: 'w' };
    const kind = explain ? explain.kind : 'best';
    const line = kind === 'reply' ? move.playedLine : move.bestLine;
    const startIndex = kind === 'reply' ? (explain ? explain.ply : viewPly) : (explain ? explain.ply : viewPly) - 1;
    const startTurn = (review.positions[Math.max(0, startIndex)] && review.positions[Math.max(0, startIndex)].turn) || 'w';
    return { line, startTurn, move, kind };
  }

  function explainMaxStep() {
    if (!explain) return 0;
    const { line } = selectedLine();
    return (line && line.uci && line.uci.length) || 0;
  }

  function exitExplain() {
    explain = null;
    window.__chess.reviewExplain = null;
    paintLineChrome();
    showBoard();
  }

  function enterExplain(kind) {
    const move = currentMove();
    if (!move) return;
    const k = kind || 'best';
    const line = k === 'reply' ? move.playedLine : move.bestLine;
    if (!line || !line.uci || !line.uci.length) {
      if (k === 'best' && move.playedLine && move.playedLine.uci && move.playedLine.uci.length) {
        enterExplain('reply');
        return;
      }
      return;
    }
    explain = { kind: k, ply: viewPly, step: 0 };
    window.__chess.reviewExplain = { ...explain };
    paintLineChrome();
    showBoard();
  }

  function setExplainStep(step) {
    if (!explain) return;
    const max = explainMaxStep();
    explain.step = Math.max(0, Math.min(max, step));
    window.__chess.reviewExplain = { ...explain };
    paintLineChrome();
    showBoard();
  }

  function nav(act) {
    if (explain) {
      const max = explainMaxStep();
      if (act === 'first') setExplainStep(0);
      else if (act === 'prev') setExplainStep(explain.step - 1);
      else if (act === 'next') setExplainStep(explain.step + 1);
      else if (act === 'last') setExplainStep(max);
      return;
    }
    if (act === 'first') showPly(0);
    else if (act === 'prev') showPly(viewPly - 1);
    else if (act === 'next') showPly(viewPly + 1);
    else if (act === 'last') showPly(maxPly());
  }

  const paint = () => {
    const summary = record ? gameSummary(record) : '';
    const progressHtml = running ? `<div class="frame review-progress" aria-live="polite">${fc}<div class="frame-inner">
      <h2>Review in progress</h2>
      <p class="review-progress-text">Evaluating the positions.</p>
      <div class="review-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span style="width:0%"></span></div>
      <p class="muted review-elapsed">The review has been running for 0 seconds.</p>
      <button class="btn" type="button" data-act="cancel">${ICONS.flag}<span>Cancel</span></button>
    </div></div>` : '';

    root.innerHTML = `
      <section class="page page-review">
        <header class="page-head review-head">
          <h1 class="page-title">Game review</h1>
          ${review ? `<button class="btn ghost btn-icon review-info-btn" type="button" data-act="info" aria-expanded="${showInfo ? 'true' : 'false'}" aria-controls="review-info" title="About these classifications"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 11 v6 M12 7.5 v.1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span>Info</span></button>` : ''}
        </header>
        ${showInfo && review ? `<div class="frame review-info" id="review-info">${fc}<div class="frame-inner">
          <p>Move labels follow chess.com's Game Review categories, using a rating-neutral approximation of expected points. Brilliant, Great and Miss use documented approximations of chess.com's published rules, and Forced is included because chess.com's review interface uses it. Accuracy scores use the Lichess method. The labels and scores are estimates at a search depth of ${REVIEW_DEPTH}. A deeper search, or a different engine, may classify some moves differently.</p>
        </div></div>` : ''}
        ${!record ? `<div class="frame">${fc}<div class="frame-inner">
          <p class="lede">Choose a game from Saved games, or review one when it ends.</p>
        </div></div>` : ''}
        ${record && !review && !running ? `<div class="frame">${fc}<div class="frame-inner">
          <p class="review-start-meta">${esc(summary)}</p>
          <div class="row">
            <button class="btn primary" type="button" data-act="start">${ICONS.play}<span>Review</span></button>
            <a class="btn" href="#/analysis" data-act="analyse"><span>Analyse</span></a>
          </div>
        </div></div>` : ''}
        ${progressHtml}
        ${review ? renderBody() : ''}
      </section>`;
    bind();
    if (review) {
      mountBoard();
      showPly(viewPly, { keepExplain: false });
    }
    window.__chess.review = review;
    window.__chess.reviewPly = viewPly;
    window.__chess.reviewExplain = explain ? { ...explain } : null;
  };

  function renderBody() {
    const acc = review.accuracy || {};
    const move = currentMove();
    return `
      <div class="game-layout review-layout">
        <div class="board-col">
          <div class="board-row-wrap">
            <div class="evalbar" data-evalbar>
              <div class="evalbar-fill" data-eval-fill></div>
              <div class="evalbar-text" data-eval-text></div>
            </div>
            <div class="board-host" data-board></div>
          </div>
        </div>
        <div class="side-col review-side">
          <div class="review-summary">
            <div class="review-acc-row">
              <div class="review-acc-side"><span class="k">White</span><span class="v">${fmtAcc(acc.w)}</span></div>
              <div class="review-acc-side"><span class="k">Black</span><span class="v">${fmtAcc(acc.b)}</span></div>
            </div>
            ${countsHtml(review)}
            <div class="review-graph-wrap">${graphSvg(review, viewPly)}</div>
          </div>
          <div class="review-current" data-current></div>
          <div class="review-line-panel" data-line-panel hidden></div>
          <div class="nav-row review-nav">
            <button class="btn" type="button" data-act="first" aria-label="First move" title="First move">${ICONS.first || '⏮'}</button>
            <button class="btn" type="button" data-act="prev" aria-label="Previous move" title="Previous move">${ICONS.prev || '◀'}</button>
            <button class="btn" type="button" data-act="next" aria-label="Next move" title="Next move">${ICONS.next || '▶'}</button>
            <button class="btn" type="button" data-act="last" aria-label="Last move" title="Last move">${ICONS.last || '⏭'}</button>
          </div>
          <div class="row review-actions">
            <button class="btn" type="button" data-act="show-line" data-show-line title="Show the engine line">Line</button>
            <button class="btn primary" type="button" data-act="exit-line" data-exit-line hidden title="Return to the game position">Exit explanation</button>
            <button class="btn ghost" type="button" data-act="arrows" data-arrows title="Green arrows show a stronger alternative. Red arrows show a threat, or the reply that punishes the move.">Hide arrows</button>
            <button class="btn ghost" type="button" data-act="flip" title="Flip the board">${ICONS.flip}<span>Flip</span></button>
            <a class="btn ghost" href="#/analysis" data-act="analyse"><span>Analyse</span></a>
          </div>
          <div class="review-movelist">${moveListHtml(review, viewPly)}</div>
        </div>
      </div>`;
  }

  function currentChipHtml() {
    const move = currentMove();
    if (!move) return `<p class="muted">Start</p>`;
    const ev = formatWhiteEval(move.evalAfter && move.evalAfter.whiteCp);
    return `${badgeChipHtml(move.judgment, JUDGMENT_LABELS[move.judgment] || move.judgment, { evalText: ev })}
      <span class="review-current-san">${move.color === 'b' ? '…' : ''}${esc(move.san)}</span>`;
  }

  function paintLineChrome() {
    const current = root.querySelector('[data-current]');
    if (current) {
      const html = currentChipHtml();
      if (current._html !== html) { current._html = html; current.innerHTML = html; }
    }
    const panel = root.querySelector('[data-line-panel]');
    const showBtn = root.querySelector('[data-show-line]');
    const exitBtn = root.querySelector('[data-exit-line]');
    const move = currentMove();
    const hasBest = !!(move && move.bestLine && move.bestLine.uci && move.bestLine.uci.length);
    const hasReply = !!(move && move.playedLine && move.playedLine.uci && move.playedLine.uci.length);
    if (showBtn) showBtn.hidden = !!(explain || (!hasBest && !hasReply) || !move);
    if (exitBtn) exitBtn.hidden = !explain;
    if (panel) {
      if (!explain) {
        if (!panel.hidden) panel.hidden = true;
        if (panel.firstChild) panel.innerHTML = '';
      } else {
        const { line, startTurn } = selectedLine();
        const switcher = (hasBest && hasReply)
          ? `<div class="review-line-switch">
              <button type="button" class="btn ghost${explain.kind === 'best' ? ' on' : ''}" data-act="line-best">Best</button>
              <button type="button" class="btn ghost${explain.kind === 'reply' ? ' on' : ''}" data-act="line-reply">Reply</button>
            </div>`
          : '';
        panel.hidden = false;
        panel.innerHTML = `${switcher}${lineListHtml(line, explain.step, startTurn)}`;
      }
    }
    const arrowBtn = root.querySelector('[data-arrows]');
    const arrowText = showArrows ? 'Hide arrows' : 'Show arrows';
    if (arrowBtn && arrowBtn.textContent !== arrowText) arrowBtn.textContent = arrowText;
    // Only the previous and the new current move change, so touch just those two.
    const list = root.querySelector('.review-moves');
    if (list) {
      const prev = list.querySelector('.mv.current');
      const next = viewPly > 0 ? list.querySelector(`.mv[data-ply="${viewPly}"]`) : null;
      if (prev !== next) {
        if (prev) prev.classList.remove('current');
        if (next) next.classList.add('current');
      }
    }
    // Move the graph cursor instead of rebuilding the whole graph.
    const cursor = root.querySelector('[data-rg-cursor]');
    if (cursor && review && !explain) {
      const x = graphCursorX(review, viewPly).toFixed(1);
      if (cursor.getAttribute('x1') !== x) { cursor.setAttribute('x1', x); cursor.setAttribute('x2', x); }
    }
  }

  function mountBoard() {
    const host = root.querySelector('[data-board]');
    if (!host) return;
    if (board) {
      board.host = host;
      board.build();
    } else {
      board = new Board(host, { orientation: 'w', showLegal: false, animations: false, label: 'Review board' });
    }
    window.__chess.reviewBoard = board;
    showBoard();
  }

  function whiteCpNow() {
    if (!review) return 0;
    if (explain) {
      const move = review.moves[explain.ply - 1];
      if (!move) return 0;
      if (explain.step === 0) {
        return explain.kind === 'reply'
          ? (move.evalAfter && move.evalAfter.whiteCp) || 0
          : (move.evalBefore && move.evalBefore.whiteCp) || 0;
      }
      const line = explain.kind === 'reply' ? move.playedLine : move.bestLine;
      if (line && line.eval) {
        const startIndex = explain.kind === 'reply' ? explain.ply : explain.ply - 1;
        const startTurn = (review.positions[Math.max(0, startIndex)] && review.positions[Math.max(0, startIndex)].turn) || 'w';
        const stepped = lineEvalAtStep(line, startTurn, explain.step);
        return stepped == null ? ((move.evalBefore && move.evalBefore.whiteCp) || 0) : stepped;
      }
      return (move.evalBefore && move.evalBefore.whiteCp) || 0;
    }
    const posn = review.positions[viewPly];
    return posn && typeof posn.whiteCp === 'number' ? posn.whiteCp : 0;
  }

  function paintEvalBar() {
    const bar = root.querySelector('[data-evalbar]');
    const fill = root.querySelector('[data-eval-fill]');
    const text = root.querySelector('[data-eval-text]');
    if (!bar || !fill) return;
    const whiteOnBottom = !board || board.opts.orientation === 'w';
    bar.classList.toggle('flipped', !whiteOnBottom);
    const whiteCp = whiteCpNow();
    const pct = evalBarPct(whiteCp);
    const fillPct = whiteOnBottom ? pct : 100 - pct;
    // scaleY is composited, so the bar animates without layout or repaint.
    const scale = `scaleY(${(fillPct / 100).toFixed(4)})`;
    // Compare with the last value set: the browser normalises style.transform
    // (scaleY(0.5000) reads back as scaleY(0.5)), so reading it back never matches.
    if (fill._scale !== scale) { fill._scale = scale; fill.style.transform = scale; }
    const evText = formatWhiteEval(whiteCp);
    if (text && text.textContent !== evText) text.textContent = evText;
  }

  function showBoard() {
    if (!board || !review) return;
    let fen, lastMove = null, arrows = [], badgeSq = null, badgeJ = null, ghosts = [];
    if (explain) {
      const move = review.moves[explain.ply - 1];
      const startIndex = explain.kind === 'reply' ? explain.ply : explain.ply - 1;
      let pos = Position.fromFen(review.positions[Math.max(0, startIndex)].fen);
      const line = (explain.kind === 'reply' ? move.playedLine : move.bestLine) || { uci: [] };
      for (let i = 0; i < explain.step; i++) {
        const m = pos.parseUci(line.uci[i]);
        if (!m) break;
        lastMove = m;
        pos = pos.makeMove(m);
      }
      fen = pos.toFen();
      const nextUci = line.uci[explain.step];
      if (nextUci && nextUci.length >= 4) {
        const files = 'abcdefgh';
        const from = files.indexOf(nextUci[0]) + (+nextUci[1] - 1) * 8;
        const to = files.indexOf(nextUci[2]) + (+nextUci[3] - 1) * 8;
        if (from >= 0 && to >= 0) {
          const mv = pos.parseUci(nextUci);
          arrows = [{ from, to, kind: explain.kind === 'reply' ? 'threat' : 'suggest', piece: mv && mv.piece }];
        }
      }
    } else {
      const posn = review.positions[viewPly];
      fen = posn.fen;
      const move = currentMove();
      if (move) {
        const m = (() => {
          try {
            const before = Position.fromFen(review.positions[viewPly - 1].fen);
            return before.parseUci(move.uci);
          } catch { return null; }
        })();
        lastMove = m;
        badgeSq = destSquare(move.uci);
        badgeJ = move.judgment;
        if (showArrows) {
          let afterPos = null, beforePos = null;
          try { afterPos = Position.fromFen(fen); } catch { afterPos = null; }
          try { beforePos = Position.fromFen(review.positions[viewPly - 1].fen); } catch { beforePos = null; }
          arrows = reviewArrowsForMove(move, afterPos, beforePos);
          if (afterPos && beforePos) {
            for (const a of arrows) {
              if (a.kind !== 'suggest') continue;
              if (afterPos.pieceAt(a.from)) continue;
              const pc = beforePos.pieceAt(a.from);
              if (pc) ghosts.push({ sq: a.from, color: pc.color, type: pc.type });
            }
          }
        }
      }
    }
    board.setView(Position.fromFen(fen), { lastMove, ghosts, arrows, badge: { sq: badgeSq, judgment: badgeJ } });
    paintEvalBar();
    window.__chess.reviewFen = fen;
    window.__chess.reviewPly = viewPly;
    window.__chess.reviewExplain = explain ? { ...explain } : null;
  }

  function showPly(ply, { keepExplain } = {}) {
    if (!review) return;
    const fromPly = viewPly;
    viewPly = Math.max(0, Math.min(maxPly(), ply));
    if (!keepExplain) explain = null;
    window.__chess.reviewPly = viewPly;
    paintLineChrome();
    showBoard();
    playReviewStep(review, fromPly, viewPly);
  }

  function goAnalyse() {
    if (!record) return;
    app.pendingLoad = { target: 'analysis', record };
    location.hash = '#/analysis';
  }

  function bind() {
    root.onclick = async (e) => {
      const lineStep = e.target.closest('[data-line-step]');
      if (lineStep && root.contains(lineStep) && explain) {
        setExplainStep(+lineStep.dataset.lineStep);
        return;
      }
      const plyEl = e.target.closest('[data-ply]');
      if (plyEl && root.contains(plyEl) && review) {
        showPly(+plyEl.dataset.ply);
        return;
      }
      const actBtn = e.target.closest('[data-act]');
      if (!actBtn) return;
      const act = actBtn.dataset.act;
      if (act === 'start') begin();
      else if (act === 'cancel') {
        cancelReview();
        running = false;
        window.__chess.reviewRunning = false;
        clearInterval(elapsedTimer);
        toast('The review was cancelled.');
        paint();
      } else if (act === 'analyse') goAnalyse();
      else if (act === 'first' || act === 'prev' || act === 'next' || act === 'last') nav(act);
      else if (act === 'show-line') enterExplain('best');
      else if (act === 'exit-line') exitExplain();
      else if (act === 'line-best') enterExplain('best');
      else if (act === 'line-reply') enterExplain('reply');
      else if (act === 'arrows') {
        showArrows = !showArrows;
        paintLineChrome();
        showBoard();
      } else if (act === 'flip') {
        if (board) board.flip();
        showBoard();
      } else if (act === 'info') {
        showInfo = !showInfo;
        paint();
      }
    };
    if (record && !review && root.querySelector('[data-act="analyse"]') && !running) {
      const a = root.querySelector('a[href="#/analysis"]');
      if (a) a.addEventListener('click', (ev) => {
        ev.preventDefault();
        goAnalyse();
      });
    }
  }

  function begin() {
    if (!record || running) return;
    const uci = record.game && record.game.uci;
    if (!uci || !uci.length) { toast('This game has no moves to review.'); return; }
    running = true;
    startMs.t = Date.now();
    paint();
    const bar = root.querySelector('.review-progress-bar span');
    const text = root.querySelector('.review-progress-text');
    const elapsedEl = root.querySelector('.review-elapsed');
    elapsedTimer = setInterval(() => {
      if (!elapsedEl) return;
      const s = Math.max(0, Math.round((Date.now() - startMs.t) / 1000));
      elapsedEl.textContent = `The review has been running for ${s} ${s === 1 ? 'second' : 'seconds'}.`;
    }, 500);
    window.__chess.reviewRunning = true;
    startReview(record, {
      depth: REVIEW_DEPTH,
      onProgress: (p) => {
        const pct = p.total ? Math.round(100 * p.done / p.total) : 0;
        if (bar) bar.style.width = pct + '%';
        const prog = root.querySelector('.review-progress-bar');
        if (prog) { prog.setAttribute('aria-valuenow', String(pct)); }
        if (text) text.textContent = p.done >= p.total
          ? 'The engine evaluations are done, and the move classifications are being finished.'
          : `Position ${p.done} of ${p.total} has been evaluated.`;
      },
      onDone: (rev) => {
        running = false;
        clearInterval(elapsedTimer);
        review = rev;
        viewPly = rev.uci.length;
        explain = null;
        window.__chess.reviewRunning = false;
        window.__chess.review = rev;
        paint();
      },
      onError: (err) => {
        running = false;
        clearInterval(elapsedTimer);
        window.__chess.reviewRunning = false;
        toast(`The review could not be completed: ${err.message}`);
        paint();
      },
    }).catch((err) => {
      if (err && err.message === 'cancelled') {
        running = false;
        window.__chess.reviewRunning = false;
        return;
      }
    });
  }

  window.__chess.review = review;
  window.__chess.reviewRecord = record;
  paint();
  // Render the Brilliant sound in idle time now, so the first Brilliant step
  // does not have to wait for it.
  preloadReviewSounds();

  return () => {
    cleanups.forEach((f) => f());
    clearInterval(elapsedTimer);
    if (isReviewing()) cancelReview();
    window.__chess.reviewRunning = false;
  };
}

export function onKey(e) {
  const page = document.querySelector('.page-review');
  if (!page) return false;
  if (e.key === 'Escape') {
    const b = page.querySelector('[data-act="exit-line"]');
    if (b && !b.hidden) {
      b.click();
      return true;
    }
    return false;
  }
  const k = e.key;
  const boardNav = k === 'ArrowLeft' || k === 'ArrowRight';
  const listNav = k === 'Home' || k === 'End' || k === 'ArrowUp' || k === 'ArrowDown';
  if (boardNav || listNav) {
    if (listNav) {
      const focus = e.target;
      const inBoard = !!(focus && focus.closest && (focus.closest('.board-wrap') || focus.closest('.review-moves') || focus.closest('[data-board]') || focus.closest('.board')));
      if (!inBoard) return false;
    }
    const act = k === 'ArrowLeft' || k === 'ArrowUp' ? 'prev' : k === 'ArrowRight' || k === 'ArrowDown' ? 'next' : k === 'Home' ? 'first' : 'last';
    const b = page.querySelector(`[data-act="${act}"]`);
    if (b && !b.disabled) b.click();
    return true;
  }
  return false;
}
