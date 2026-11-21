/** The size limit of a /v1 request body, and the 413 answer above it. */
import { constants } from 'node:buffer';
import { BodyTooLargeError, InvalidJsonError } from './util.mjs';

const MIB = 1024 * 1024;
const DEFAULT_MIB = 256;

/**
 * The most a /v1 request body may hold, in bytes: 256 MiB, as in the model server (terminal/serve/server.py body_limit).
 * STRATA_MAX_BODY_MIB changes it; zero, a negative number or an unreadable value keeps the default. The body is read into
 * one string, so the result never passes the longest string Node can hold.
 */
export function maxBodyBytes(env = process.env) {
  const text = String(env.STRATA_MAX_BODY_MIB ?? '').trim();
  const mib = /^\+?\d+$/.test(text) ? Number(text) : 0;
  const bytes = (mib > 0 ? mib : DEFAULT_MIB) * MIB;
  return Math.min(bytes, Math.floor(constants.MAX_STRING_LENGTH / MIB) * MIB);   // whole MiB, so the 413 sentence has no fraction
}

/**
 * Read a JSON request body of at most `limit` bytes. Past the limit nothing more is kept, but the body is still read to its
 * end: an answer sent while the client is still uploading is often lost to a reset connection. `idleMs` counts the time
 * without data (not the total time), so a slow upload is not cut off; past the limit it ends the wait for the rest.
 * Throws BodyTooLargeError, or InvalidJsonError for a body that is not JSON. An empty body is {}.
 */
export function readJsonWithin(req, limit, idleMs = 15000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let over = Number(req.headers?.['content-length']) > limit;
    let timer = null;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('close', onClose);
      // The error listener stays so a late 'error' after settling is not an uncaught exception; resume keeps discarding what is still coming.
      req.on('error', () => {});
      req.resume();
      fn(value);
    };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(reject, new BodyTooLargeError(limit)), idleMs);
    };
    function onData(chunk) {
      if (!over) {
        size += chunk.length;
        if (size > limit) {
          over = true;
          chunks.length = 0;
        } else {
          chunks.push(chunk);
          return;
        }
      }
      arm();
    }
    function onEnd() {
      if (over) return finish(reject, new BodyTooLargeError(limit));
      if (!chunks.length) return finish(resolve, {});
      try {
        finish(resolve, JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        finish(reject, new InvalidJsonError('Body must be JSON'));
      }
    }
    function onError(err) {
      finish(reject, err);
    }
    function onClose() {
      // The client went away before the end: nothing can be answered, and the wait must not stay open.
      finish(reject, new Error('Request aborted'));
    }
    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
    req.on('close', onClose);
    if (over) arm();
  });
}

/** The JSON that answers a request over the limit with 413 (the model server's sentence; `adjustable`: the limit can be raised with STRATA_MAX_BODY_MIB). */
export function tooLargeBody(path, limit, adjustable) {
  const message = `the request body is larger than ${limit / MIB} MiB${adjustable ? ' (STRATA_MAX_BODY_MIB raises the limit)' : ''}`;
  if (path === '/v1/messages') return { type: 'error', error: { type: 'request_too_large', message } };
  return { error: { type: 'invalid_request_error', message, param: null, code: 'request_too_large' } };
}
