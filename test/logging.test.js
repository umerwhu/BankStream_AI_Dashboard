import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile, utimes, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import express from 'express';
import { createLogger, formatLogEntry, logger, requestContext, safeError } from '../src/utils/logger.js';
import { requestLogging } from '../src/middleware/request-logging.js';
import { errorHandler } from '../src/middleware/errors.js';
import { loggedFetch } from '../src/utils/logged-fetch.js';

test('Readable files have UTC fields, separate errors, rotate, cap files and expire old logs', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bankstream-logging-'));
  await mkdir(path.join(directory, 'archived'));
  const expired = path.join(directory, 'archived', 'application-2000-01-01.log');
  await writeFile(expired, 'old');
  await utimes(expired, new Date(0), new Date(0));
  const log = createLogger({ directory, console: false, level: 'debug', maxSize: '1k', maxFiles: 3, retentionDays: 1 });
  for (let i = 0; i < 40; i++) log.info('Operation completed', { event: 'test.complete', padding: 'x'.repeat(900) });
  log.error('Operation failed', { event: 'test.failure', error: safeError(new Error('password=secret customer=123')) });
  log.debug('Hidden file diagnostic', { event: 'test.debug' });
  const finished = once(log, 'finish'); log.end(); await finished;
  // Rotating transport file streams close asynchronously after logger finish.
  await new Promise(resolve => setTimeout(resolve, 100));
  const files = (await readdir(path.join(directory, 'archived'))).filter(file => file.includes('.log'));
  assert.ok(!files.includes('application-2000-01-01.log'));
  assert.ok(files.filter(file => file.startsWith('application')).length <= 3);
  const entries = (await Promise.all(files.map(file => readFile(path.join(directory, 'archived', file), 'utf8')))).join('\n').split('\n').filter(Boolean);
  assert.ok(entries.length > 1);
  for (const entry of entries) {
    const timestamp = entry.split(' ')[0];
    assert.equal(new Date(timestamp).toISOString(), timestamp);
    assert.match(entry, /^\S+ (INFO|ERROR): /);
    for (const field of ['Event:', 'RequestID:', 'Method:', 'Endpoint:', 'Status:', 'Duration:']) assert.ok(entry.includes(field));
  }
  assert.ok(!JSON.stringify(entries).includes('password=secret'));
  const errors = files.filter(file => file.startsWith('error'));
  assert.ok(errors.length);
  for (const file of errors) for (const line of (await readFile(path.join(directory,'archived',file),'utf8')).trim().split('\n')) assert.match(line, /^\S+ ERROR: /);
});

test('HTTP and downstream logs correlate, redact sensitive data, and report timeout and polling failures once', async () => {
  const records = [], originalLog = logger.log.bind(logger), originalFetch = globalThis.fetch;
  logger.log = (...args) => { const [level, message, fields] = args; records.push({ level, message, ...fields }); return logger; };
  const app = express(); app.use(requestLogging);
  app.get('/api/customers/:id', async (req,res) => {
    await loggedFetch('https://example.test?token=secret', { headers: { Authorization: 'secret' } }, { apiName:'TapData', endpoint:'/api/customer360' });
    res.sendStatus(200);
  });
  app.get('/api/dashboard', async () => { throw new Error('customer secret'); });
  app.use(errorHandler);
  const server = app.listen(0,'127.0.0.1'); await once(server,'listening');
  try {
    globalThis.fetch = async () => { await new Promise(resolve => setTimeout(resolve, 15)); return new Response('{}'); };
    const response = await originalFetch(`http://127.0.0.1:${server.address().port}/api/customers/private-customer?password=secret`);
    await response.text();
    const incoming = records.find(r => r.event === 'http.complete'), outgoing = records.find(r => r.event === 'upstream.complete');
    assert.equal(incoming.requestId, outgoing.requestId);
    assert.equal(response.headers.get('x-request-id'), incoming.requestId);
    assert.equal(incoming.endpoint, '/api/customers/:id');
    assert.equal(outgoing.status, 200); assert.ok(outgoing.durationMs >= 10);
    assert.ok(incoming.durationMs >= outgoing.durationMs);
    await originalFetch(`http://127.0.0.1:${server.address().port}/api/dashboard`).then(r=>r.text());
    assert.equal(records.filter(r => r.event === 'poll.complete').length, 1);
    assert.equal(records.find(r => r.event === 'poll.complete').level, 'error');
    globalThis.fetch = async () => { throw new DOMException('token=secret', 'TimeoutError'); };
    await assert.rejects(requestContext.run({requestId:'test-request'}, () => loggedFetch('https://example.test', {}, {apiName:'TapData',endpoint:'/api/customer360',maxAttempts:3})));
    const timeout = records.find(r => r.event === 'upstream.failure');
    assert.equal(timeout.timeout,true); assert.equal(timeout.retry,true); assert.equal(timeout.requestId,'test-request');
    assert.ok(!JSON.stringify(records).includes('secret'));
    assert.ok(!JSON.stringify(records).includes('private-customer'));
  } finally { globalThis.fetch=originalFetch; logger.log=originalLog; await new Promise(resolve=>server.close(resolve)); }
});

 test('shared formatter matches readable API example and preserves extra metadata', () => {
  const entry = { timestamp: '2026-10-28T06:10:55.505Z', level: 'info', message: 'Downstream API response received', apiName: 'TapData', method: 'GET', endpoint: '/api/v1/MDM_CUSTOMER360', status: 200, durationMs: 30.09, requestId: 'abc123' };
  assert.equal(formatLogEntry(entry), '2026-10-28T06:10:55.505Z INFO: Downstream API response received | API: TapData | GET /api/v1/MDM_CUSTOMER360 | Status: 200 | Duration: 30.09ms | RequestID: abc123');
  const text = formatLogEntry({...entry, retry: false, attempt: 2, error: {name: 'Error', stack: 'frame1\\nframe2'}});
  assert.ok(text.includes('Retry: false | Attempt: 2 | Error:'));
  assert.ok(text.includes('frame1'));
  assert.equal(text.split('\n').length, 1);
});
