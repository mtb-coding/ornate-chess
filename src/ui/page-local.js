import { makeGamePage } from './page-game.js';
const page = makeGamePage('local');
export const render = page.render;
export const onKey = page.onKey;
