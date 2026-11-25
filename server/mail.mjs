// Sends a confirmation message. Without SMTP settings the message is saved
// under server/data/outbox, which is not part of the source distribution.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { HttpError } from './errors.mjs';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));

function smtpEnv() {
  const host = process.env.ORNATE_SMTP_HOST;
  if (!host) return null;
  return {
    host,
    port: Number(process.env.ORNATE_SMTP_PORT || 587),
    user: process.env.ORNATE_SMTP_USER || '',
    pass: process.env.ORNATE_SMTP_PASS || '',
    from: process.env.ORNATE_SMTP_FROM || process.env.ORNATE_SMTP_USER || '',
  };
}

function readReply(socket) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('error', onError);
    };
    const onError = (err) => { cleanup(); reject(err); };
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      const lines = buf.split(/\r\n/);
      const finished = lines.slice(0, -1);
      const last = finished[finished.length - 1];
      if (last && /^\d{3} /.test(last)) {
        cleanup();
        resolve(Number(last.slice(0, 3)));
      }
    };
    socket.on('data', onData);
    socket.on('error', onError);
  });
}

function command(socket, line) {
  socket.write(`${line}\r\n`);
  return readReply(socket);
}

async function expect(socket, line, ok) {
  const code = await command(socket, line);
  if (!ok.includes(code)) throw new HttpError(502, 'The confirmation email could not be sent. The password was not changed.');
  return code;
}

function sendSmtp(settings, { to, subject, text }) {
  return new Promise((resolve, reject) => {
    const fail = (err) => reject(err instanceof HttpError ? err : new HttpError(502, 'The confirmation email could not be sent. The password was not changed.'));
    const socket = net.connect(settings.port, settings.host);
    socket.once('error', fail);
    const dotted = text.replace(/\r?\n/g, '\r\n').split('\r\n').map((line) => (line.startsWith('.') ? `.${line}` : line)).join('\r\n');
    const body = `From: ${settings.from}\r\nTo: ${to}\r\nSubject: ${subject}\r\n\r\n${dotted}\r\n.`;
    readReply(socket).then(async (greeting) => {
      if (greeting !== 220) throw new HttpError(502, 'The confirmation email could not be sent. The password was not changed.');
      await expect(socket, `EHLO ornate-chess`, [250]);
      if (settings.port !== 465) {
        await expect(socket, 'STARTTLS', [220]);
        const secure = tls.connect({ socket, servername: settings.host });
        await new Promise((done, rejectTls) => {
          secure.once('secureConnect', done);
          secure.once('error', rejectTls);
        });
        secure.removeAllListeners('error');
        secure.once('error', fail);
        await expect(secure, `EHLO ornate-chess`, [250]);
        if (settings.user) {
          await expect(secure, 'AUTH LOGIN', [334]);
          await expect(secure, Buffer.from(settings.user).toString('base64'), [334]);
          await expect(secure, Buffer.from(settings.pass).toString('base64'), [235]);
        }
        await expect(secure, `MAIL FROM:<${settings.from}>`, [250]);
        await expect(secure, `RCPT TO:<${to}>`, [250, 251]);
        await expect(secure, 'DATA', [354]);
        await expect(secure, body, [250]);
        await expect(secure, 'QUIT', [221]);
        secure.end();
        resolve();
        return;
      }
      throw new HttpError(502, 'The confirmation email could not be sent. The password was not changed.');
    }).catch(fail);
  });
}

function saveLocal({ to, subject, text }) {
  const dir = path.join(SERVER_DIR, 'data', 'outbox');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${randomUUID()}.txt`);
  fs.writeFileSync(file, `To: ${to}\r\nSubject: ${subject}\r\n\r\n${text}\r\n`, 'utf8');
  return file;
}

export async function sendMail(message) {
  const settings = smtpEnv();
  if (!settings) {
    saveLocal(message);
    return { delivery: 'saved' };
  }
  if (!settings.from) throw new HttpError(502, 'The confirmation email could not be sent. The password was not changed.');
  await sendSmtp(settings, message);
  return { delivery: 'sent' };
}
