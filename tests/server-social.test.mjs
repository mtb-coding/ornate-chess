// Public profiles and follows. Cheat marks stay off these pages.
import assert from 'node:assert/strict';
import { startTestServer } from './server-harness.mjs';

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`ok   ${name}`); }
  catch (err) { failed += 1; console.error(`FAIL ${name}\n  ${err.stack || err.message}`); }
}

await test('a player page and the following list stay on the account', async () => {
  const srv = await startTestServer();
  try {
    const ada = await srv.api('POST', '/api/auth/register', { body: { username: 'Ada_social', password: 'correct-horse', email: 'ada_social@example.com' } });
    const bea = await srv.api('POST', '/api/auth/register', { body: { username: 'bea_social', password: 'correct-horse', email: 'bea_social@example.com' } });
    assert.equal(ada.status, 200);
    const hidden = await srv.api('GET', '/api/following');
    assert.equal(hidden.status, 401);
    const missing = await srv.api('GET', '/api/players/nobody_here');
    assert.equal(missing.status, 404);
    const self = await srv.api('POST', '/api/follow', { token: ada.json.token, body: { username: 'ada_social' } });
    assert.equal(self.status, 400);
    const followed = await srv.api('POST', '/api/follow', { token: ada.json.token, body: { username: 'BEA_social' } });
    assert.equal(followed.status, 200);
    assert.equal(followed.json.following, true);
    const again = await srv.api('POST', '/api/follow', { token: ada.json.token, body: { username: 'bea_social' } });
    assert.equal(again.json.following, true);
    srv.db.prepare(`INSERT INTO pace_ratings (
      user_id, pace, rating, deviation, volatility, games, wins, draws, losses, peak,
      white_json, black_json, history_json, updated_at
    ) VALUES (?, 'blitz', 1620, 90, 0.06, 6, 4, 1, 1, 1620, '{}', '{}', '[]', 9)`).run(bea.json.user.id);
    srv.db.prepare(`INSERT INTO live_games (
      id, base_ms, inc_ms, white_id, black_id, white_name, black_name, game_json,
      w_ms, b_ms, turn_started_at, status, result, result_reason, draw_offer, created_at, updated_at
    ) VALUES ('social-game', 180000, 2000, ?, ?, 'bea_social', 'Ada_social', '{}', 1, 1, NULL, 'finished', '1-0', 'checkmate', NULL, 10, 20)`).run(bea.json.user.id, ada.json.user.id);
    const page = await srv.api('GET', '/api/players/bea_social', { token: ada.json.token });
    assert.equal(page.status, 200);
    assert.equal(page.json.username, 'bea_social');
    assert.equal(page.json.following, true);
    assert.equal(page.json.followers, 1);
    assert.equal(page.json.ratings.blitz.rating, 1620);
    assert.equal(page.json.ratings.blitz.provisional, false);
    assert.equal(page.json.ratings.bullet, null);
    assert.equal(page.json.games[0].outcome, 'win');
    assert.equal(page.json.games[0].opponent, 'Ada_social');
    assert.equal(page.json.games[0].pace, 'blitz');
    const feed = await srv.api('GET', '/api/following', { token: ada.json.token });
    assert.deepEqual(feed.json.players.map((row) => row.username), ['bea_social']);
    assert.equal(feed.json.games[0].player, 'bea_social');
    const gone = await srv.api('POST', '/api/unfollow', { token: ada.json.token, body: { username: 'bea_social' } });
    assert.equal(gone.json.following, false);
    const empty = await srv.api('GET', '/api/following', { token: ada.json.token });
    assert.deepEqual(empty.json.players, []);
    const stranger = await srv.api('GET', '/api/players/bea_social');
    assert.equal(stranger.json.following, null);
    assert.equal(stranger.json.followers, 0);
  } finally {
    await srv.close();
  }
});

console.log(failed ? `\n${failed} failed` : '\nSocial checks passed');
process.exit(failed ? 1 : 0);
