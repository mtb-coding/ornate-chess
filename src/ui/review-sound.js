// Sounds for stepping through a Game Review. Landing on a move plays that
// move's normal sound (move, capture, castle, check or promotion), except a
// move labelled Brilliant, which plays the Brilliant sound instead, as on
// chess.com. Great, Best and every other label keep the normal sound.
// A single step back is silent, and so is returning to the start position.
//
// The Brilliant sound is rendered ahead of time (preloadReviewSounds, called
// when the review page opens, and again when the audio context is created).
// If a step lands on a Brilliant move before it is ready, that step plays the
// move's normal sound instead, so a step never waits for the render.
import { play, preloadSound } from './sound.js';
import { settings } from './state.js';

/** The same choice as soundForMove() in sound.js, read from SAN such as "exd8=Q+". */
export function soundForSan(san) {
  const s = String(san || '');
  if (/[+#]/.test(s)) return 'check';
  if (s.includes('=')) return 'promote';
  if (/^(O-O|0-0)/.test(s)) return 'castle';
  if (s.includes('x')) return 'capture';
  return 'move';
}

function sanAt(review, ply) {
  return (review.sans && review.sans[ply - 1]) || (review.moves[ply - 1] && review.moves[ply - 1].san) || '';
}

/** Which sound to play when the review moves from fromPly to toPly, or null. */
export function reviewSoundKind(review, fromPly, toPly) {
  if (!review || !review.moves) return null;
  if (!(toPly > 0) || toPly === fromPly || toPly === fromPly - 1) return null;
  const move = review.moves[toPly - 1];
  if (!move) return null;
  if (move.judgment === 'brilliant') return 'brilliant';
  return soundForSan(sanAt(review, toPly));
}

/** Plays the review step sound, respecting the sound setting. */
export function playReviewStep(review, fromPly, toPly) {
  try {
    if (settings().sound === false) return null;
    const kind = reviewSoundKind(review, fromPly, toPly);
    if (kind === 'brilliant') play(kind, { fallback: soundForSan(sanAt(review, toPly)) });
    else if (kind) play(kind);
    return kind;
  } catch { return null; }
}

/** Starts rendering the Brilliant sound in idle time. Never blocks. */
export function preloadReviewSounds() {
  try {
    if (settings().sound === false) return Promise.resolve(false);
    return preloadSound('brilliant');
  } catch { return Promise.resolve(false); }
}
