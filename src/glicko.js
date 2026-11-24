// Glicko-2, from Mark Glickman's rating-period formulas.
// A rating is provisional while its deviation is above 110.
// One game is one rating period, which is how a live game is scored.

export const GLICKO_SCALE = 173.7178;
export const GLICKO_TAU = 0.5;
export const GLICKO_START_RATING = 1500;
export const GLICKO_START_DEVIATION = 350;
export const GLICKO_START_VOLATILITY = 0.06;
export const PROVISIONAL_DEVIATION = 110;

export function isProvisionalDeviation(deviation) {
  return !(typeof deviation === 'number' && Number.isFinite(deviation) && deviation <= PROVISIONAL_DEVIATION);
}

/** "1500?" while the deviation is above 110, "1500" afterwards. */
export function formatGlicko(rating, deviation) {
  const shown = Math.round(Number(rating) || 0);
  return `${shown}${isProvisionalDeviation(deviation) ? '?' : ''}`;
}

function gOf(phi) {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function expected(mu, muOpp, phiOpp) {
  return 1 / (1 + Math.exp(-gOf(phiOpp) * (mu - muOpp)));
}

function newVolatility(phi, v, delta, sigma, tau) {
  const a = Math.log(sigma * sigma);
  const f = (x) => {
    const ex = Math.exp(x);
    const num = ex * (delta * delta - phi * phi - v - ex);
    const den = 2 * (phi * phi + v + ex) ** 2;
    return num / den - (x - a) / (tau * tau);
  };
  let A = a;
  let B;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else {
    let k = 1;
    while (f(a - k * tau) < 0 && k < 80) k += 1;
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  let guard = 0;
  while (Math.abs(B - A) > 1e-6 && guard < 100) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else fA /= 2;
    B = C;
    fB = fC;
    guard += 1;
  }
  return Math.exp(A / 2);
}

/**
 * One rating period. player: { rating, deviation, volatility }.
 * games: [{ rating, deviation, score }] with score 0, 0.5 or 1.
 * Returns the new { rating, deviation, volatility } at full precision.
 */
export function glickoPeriod(player, games, tau = GLICKO_TAU) {
  const rating = Number(player.rating);
  const deviation = Number(player.deviation);
  const volatility = Number(player.volatility);
  if (!Number.isFinite(rating) || !Number.isFinite(deviation) || !Number.isFinite(volatility)) {
    throw new Error('A Glicko rating needs a finite rating, deviation and volatility.');
  }
  const mu = (rating - GLICKO_START_RATING) / GLICKO_SCALE;
  const phi = deviation / GLICKO_SCALE;
  const list = Array.isArray(games) ? games : [];
  for (const game of list) {
    if (![0, 0.5, 1].includes(game.score)) throw new Error('The score must be 0, 0.5 or 1.');
  }
  if (!list.length) {
    const phiStar = Math.sqrt(phi * phi + volatility * volatility);
    return { rating, deviation: GLICKO_SCALE * phiStar, volatility };
  }
  let varianceSum = 0;
  let outcomeSum = 0;
  for (const game of list) {
    const muOpp = (Number(game.rating) - GLICKO_START_RATING) / GLICKO_SCALE;
    const phiOpp = Number(game.deviation) / GLICKO_SCALE;
    const scale = gOf(phiOpp);
    const exp = expected(mu, muOpp, phiOpp);
    varianceSum += scale * scale * exp * (1 - exp);
    outcomeSum += scale * (game.score - exp);
  }
  const v = 1 / varianceSum;
  const delta = v * outcomeSum;
  const sigma = newVolatility(phi, v, delta, volatility, tau);
  const phiStar = Math.sqrt(phi * phi + sigma * sigma);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phiPrime * phiPrime * outcomeSum;
  return {
    rating: GLICKO_SCALE * muPrime + GLICKO_START_RATING,
    deviation: GLICKO_SCALE * phiPrime,
    volatility: sigma,
  };
}
