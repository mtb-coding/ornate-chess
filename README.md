# Ornate Chess

Ornate Chess is a chess application that runs in the browser. You can play the bot, play a person on the same device, solve puzzles, browse openings, practise endgames, and play online. Online games are checked by the server. Bullet, Blitz, and Rapid each have their own rating. Games against the bot do not change those ratings.

Copyright (C) 2026 mtb-coding

This program is free software under the GNU General Public License, version 3. You can redistribute it and change it under the terms of that licence. The full text is in [LICENSE](LICENSE). There is no warranty.

## Run it on this computer

The pages are static files. Node.js 22.13 or newer is required for the account server.

1. Install the server libraries: `npm install` inside the `server` folder.
2. Start the account server from the project folder: `node server/index.mjs`. It listens on `http://127.0.0.1:8488`.
3. Start the page server: `start.bat`, or `powershell -ExecutionPolicy Bypass -File serve.ps1`. The app is at `http://localhost:8002/`.
4. For saved game reviews, mistake puzzles, and database backups, also run `node server/worker.mjs`.

The account database is created at `server/data/ornate.sqlite`. That folder is not part of the source distribution.

## Chess engine

The included engine is Stockfish.js 19, a single-threaded lite build by Chess.com, based on Stockfish by the Stockfish developers. Ornate Chess uses those files unchanged. Their licence is `src/vendor/stockfish/COPYING.txt`.

- Stockfish source: <https://github.com/official-stockfish/Stockfish>
- Source of this build: <https://github.com/nmrugg/stockfish.js>

Stockfish is a trademark of the Stockfish team. Ornate Chess is not a Stockfish product.

The opening names shipped with the app come from the Lichess chess-openings collection, which is dedicated to the public domain under CC0-1.0.
