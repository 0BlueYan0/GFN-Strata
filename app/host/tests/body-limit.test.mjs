/** The size limit of a /v1 request body: the limit setting, the reader, the 413 answer, and the wiring in the host. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { constants } from 'node:buffer';
import { request, createServer as createHttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { maxBodyBytes, readJsonWithin, tooLargeBody } from '../server/body-limit.mjs';
import { BodyTooLargeError, InvalidJsonError, readBody } from '../server/util.mjs';
import { ROOMY_HOST } from './helpers/hardware.mjs';

const MIB = 1024 * 1024;
const root = resolve(import.meta.dirname, '..');

test('maxBodyBytes: 256 MiB unless STRATA_MAX_BODY_MIB is a positive whole number', () => {
  assert.equal(maxBodyBytes({}), 256 * MIB);
  assert.equal(maxBodyBytes({ STRATA_MAX_BODY_MIB: '64' }), 64 * MIB);
  for (const bad of ['0', '-1', 'abc', '', '1.5', '12abc']) assert.equal(maxBodyBytes({ STRATA_MAX_BODY_MIB: bad }), 256 * MIB, bad);
  const capped = maxBodyBytes({ STRATA_MAX_BODY_MIB: '9999' });
  assert.ok(capped <= constants.MAX_STRING_LENGTH);
  assert.equal(capped % MIB, 0);
  assert.ok(Number.isInteger(capped / MIB));
});

test('readBody throws BodyTooLargeError carrying the limit, with the usual message', async () => {
  await assert.rejects(readBody(Readable.from([Buffer.alloc(100)]), 50), err => {
    assert.ok(err instanceof BodyTooLargeError);
    assert.equal(err.limit, 50);
    assert.equal(err.message, 'Request body too large');
    return true;
  });
  assert.deepEqual(await readBody(Readable.from([Buffer.from('{"a":1}')]), 50), { a: 1 });
});

test('readJsonWithin: empty body is {}, bad JSON is InvalidJsonError, a body within the limit is parsed', async () => {
  assert.deepEqual(await readJsonWithin(Readable.from([]), 1000), {});
  await assert.rejects(readJsonWithin(Readable.from([Buffer.from('not json')]), 1000), InvalidJsonError);
  assert.deepEqual(await readJsonWithin(Readable.from([Buffer.from('{"a":'), Buffer.from('[1,2]}')]), 1000), { a: [1, 2] });
  await assert.rejects(readJsonWithin(Readable.from([Buffer.alloc(2000)]), 1000), err => err instanceof BodyTooLargeError && err.limit === 1000);
});

test('tooLargeBody: the model server sentence, in the shape of each API', () => {
  const open = tooLargeBody('/v1/chat/completions', MIB, true);
  assert.equal(open.error.message, 'the request body is larger than 1 MiB (STRATA_MAX_BODY_MIB raises the limit)');
  assert.deepEqual({ ...open.error, message: '' }, { type: 'invalid_request_error', message: '', param: null, code: 'request_too_large' });
  assert.equal(tooLargeBody('/v1/responses', 4 * MIB, false).error.message, 'the request body is larger than 4 MiB');
  assert.deepEqual(tooLargeBody('/v1/messages', MIB, false), { type: 'error', error: { type: 'request_too_large', message: 'the request body is larger than 1 MiB' } });
});

/** One request to `port`: resolves with { status, body } or { code } when the connection broke. */
function send(port, path, { length, chunked = false, slow = 0, stall = false } = {}) {
  return new Promise(resolveSend => {
    const headers = { 'content-type': 'application/json' };
    if (!chunked && length !== undefined) headers['content-length'] = String(length);
    const req = request({ host: '127.0.0.1', port, path, method: 'POST', headers, agent: false });
    let done = false;
    const end = value => { if (done) return; done = true; req.destroy(); resolveSend(value); };
    req.on('response', res => {
      const parts = [];
      res.on('data', c => parts.push(c));
      res.on('end', () => end({ status: res.statusCode, body: Buffer.concat(parts).toString('utf8') }));
      res.on('error', err => end({ code: err.code }));
    });
    req.on('error', err => end({ code: err.code ?? err.message }));
    (async () => {
      // `{"pad":"xxx…"}`, so a body within the limit is valid JSON
      const whole = Buffer.alloc(length, 0x78);
      whole.write('{"pad":"', 0); whole.write('"}', length - 2);
      let sent = 0;
      while (!done && sent < length) {
        const part = whole.subarray(sent, Math.min(sent + MIB / 4, length));
        sent += part.length;
        await new Promise(r => req.write(part, r));   // the callback is the backpressure: no listener is added per piece
        if (slow) await new Promise(r => setTimeout(r, slow));
      }
      if (!done && !stall) req.end();
    })().catch(() => {});
  });
}

test('over the limit the answer is 413 and never a reset connection', { timeout: 120000 }, async () => {
  const server = createHttpServer(async (req, res) => {
    try {
      const body = await readJsonWithin(req, MIB, 300);
      const payload = JSON.stringify({ ok: true, body });
      res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
      res.end(payload);
    } catch (err) {
      if (!(err instanceof BodyTooLargeError)) { res.writeHead(500); return res.end(); }
      const payload = JSON.stringify(tooLargeBody(req.url, err.limit, false));
      res.writeHead(413, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), connection: 'close' });
      res.end(payload);
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const cases = [
    ['chunked 2 MiB', { length: 2 * MIB, chunked: true }, 413],
    ['chunked 64 MiB', { length: 64 * MIB, chunked: true }, 413],
    ['Content-Length 13 MiB', { length: 13 * MIB }, 413],
    ['Content-Length 16 MiB', { length: 16 * MIB }, 413],
    ['half a MiB, within the limit', { length: MIB / 2 }, 200],
    ['a slow upload over the limit, never idle', { length: 3 * MIB / 2, slow: 100 }, 413],
    ['a stalled upload over the limit', { length: 2 * MIB, stall: true, chunked: true }, 413],
  ];
  try {
    for (const [name, options, status] of cases) {
      for (let run = 1; run <= 3; run++) {
        const path = ['/v1/chat/completions', '/v1/responses', '/v1/messages'][run - 1];
        const got = await send(port, path, options);
        assert.equal(got.code, undefined, `${name} #${run}: connection error ${got.code}`);
        assert.equal(got.status, status, `${name} #${run}`);
        if (status === 413) {
          const parsed = JSON.parse(got.body);
          assert.match(JSON.stringify(parsed), /1 MiB/, name);
          if (path === '/v1/messages') assert.equal(parsed.error.type, 'request_too_large');
          else assert.equal(parsed.error.code, 'request_too_large');
        }
      }
    }
  } finally {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
});

test('the host answers 413 above 4 MiB while no model is loaded, in the shape of each API', { timeout: 60000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'strata-body-limit-'));
  const socket = createNetServer(); await new Promise(r => socket.listen(0, '127.0.0.1', r));
  const port = socket.address().port; await new Promise(r => socket.close(r));
  const host = spawn(process.execPath, ['server/index.mjs'], { cwd: root, env: { ...process.env, STRATA_HOME: home, STRATA_MODELS_DIR: join(home, 'models'), STRATA_PORT: String(port), STRATA_REAL_ENGINE: '0', STRATA_TEST_HARDWARE: ROOMY_HOST }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; host.stdout.on('data', d => logs += d); host.stderr.on('data', d => logs += d);
  try {
    let up = false;
    for (let i = 0; i < 80 && !up; i++) { try { up = (await fetch(`http://127.0.0.1:${port}/api/models`)).status === 200; } catch {} if (!up) await new Promise(r => setTimeout(r, 100)); }
    assert.ok(up, logs);
    for (const path of ['/v1/chat/completions', '/v1/messages']) {
      const got = await send(port, path, { length: 5 * MIB });
      assert.equal(got.code, undefined, `${path}: ${got.code}\n${logs}`);
      assert.equal(got.status, 413, `${path}: ${got.body}`);
      const parsed = JSON.parse(got.body);
      assert.equal(parsed.error.message, 'the request body is larger than 4 MiB');
      if (path === '/v1/messages') { assert.equal(parsed.type, 'error'); assert.equal(parsed.error.type, 'request_too_large'); }
      else assert.equal(parsed.error.code, 'request_too_large');
    }
  } finally {
    host.kill('SIGTERM'); await new Promise(r => host.once('exit', r)); await rm(home, { recursive: true, force: true });
  }
});
