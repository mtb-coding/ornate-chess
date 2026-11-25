// Sends a confirmation message. Without SMTP settings the message is saved
// under server/data/outbox, which is not part of the source distribution.
// Port 465 uses implicit TLS. Every other port, including 587, uses STARTTLS.
// A socket that stalls gives up after 15 seconds.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { HttpError } from './errors.mjs';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const FAIL = 'The confirmation email could not be sent. The password was not changed.';
const SMTP_TIMEOUT_MS = 15000;

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
  if (!ok.includes(code)) throw new HttpError(502, FAIL);
  return code;
}

function arm(socket) {
  socket.setTimeout(SMTP_TIMEOUT_MS);
  socket.on('timeout', () => socket.destroy(new HttpError(502, FAIL)));
}

async function deliver(socket, settings, { to, subject, text }) {
  await expect(socket, 'EHLO ornate-chess', [250]);
  if (settings.user) {
    await expect(socket, 'AUTH LOGIN', [334]);
    await expect(socket, Buffer.from(settings.user).toString('base64'), [334]);
    await expect(socket, Buffer.from(settings.pass).toString('base64'), [235]);
  }
  await expect(socket, `MAIL FROM:<${settings.from}>`, [250]);
  await expect(socket, `RCPT TO:<${to}>`, [250, 251]);
  await expect(socket, 'DATA', [354]);
  const dotted = text.replace(/\r?\n/g, '\r\n').split('\r\n').map((line) => (line.startsWith('.') ? `.${line}` : line)).join('\r\n');
  const body = `From: ${settings.from}\r\nTo: ${to}\r\nSubject: ${subject}\r\n\r\n${dotted}\r\n.`;
  await expect(socket, body, [250]);
  await expect(socket, 'QUIT', [221]);
}

function sendSmtp(settings, message) {
  return new Promise((resolve, reject) => {
    const fail = (err) => reject(err instanceof HttpError ? err : new HttpError(502, FAIL));
    const implicitTls = settings.port === 465;
    const socket = implicitTls
      ? tls.connect({ host: settings.host, port: settings.port, servername: settings.host })
      : net.connect(settings.port, settings.host);
    arm(socket);
    socket.once('error', fail);
    readReply(socket).then(async (greeting) => {
      if (greeting !== 220) throw new HttpError(502, FAIL);
      let channel = socket;
      if (!implicitTls) {
        await expect(socket, 'EHLO ornate-chess', [250]);
        await expect(socket, 'STARTTLS', [220]);
        channel = tls.connect({ socket, servername: settings.host });
        arm(channel);
        await new Promise((done, rejectTls) => {
          channel.once('secureConnect', done);
          channel.once('error', rejectTls);
        });
        channel.removeAllListeners('error');
        channel.once('error', fail);
      }
      await deliver(channel, settings, message);
      channel.end();
      resolve();
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
  if (!settings.from) throw new HttpError(502, FAIL);
  await sendSmtp(settings, message);
  return { delivery: 'sent' };
}
