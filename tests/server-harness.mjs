// Starts the API on an ephemeral port with a temporary database.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../server/db.mjs';
import { createServer } from '../server/index.mjs';

export async function startTestServer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ornate-server-'));
  const db = openDatabase(path.join(dir, 'test.sqlite'));
  const srv = await createServer({ db, port: 0 });
  return {
    db,
    port: srv.port,
    async close() {
      await srv.close();
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
    async api(method, pathname, { token, body, origin } = {}) {
      const headers = {};
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (token) headers.authorization = `Bearer ${token}`;
      if (origin) headers.origin = origin;
      const res = await fetch(`http://127.0.0.1:${srv.port}${pathname}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      let json = null;
      if (text) {
        try { json = JSON.parse(text); } catch { json = text; }
      }
      return { status: res.status, json, headers: res.headers };
    },
  };
}
