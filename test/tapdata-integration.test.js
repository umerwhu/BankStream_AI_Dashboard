import test from 'node:test';
import assert from 'node:assert/strict';
import { loadEnvFile } from 'node:process';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

class SafeFailure extends Error {}
function requireValue(condition, message) {
  if (!condition) throw new SafeFailure(message);
}

async function request(url, options, timeout) {
  try {
    return await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(timeout) });
  } catch (error) {
    const reasons = {
      ECONNREFUSED: 'connection refused', ENOTFOUND: 'DNS lookup failed',
      EAI_AGAIN: 'DNS lookup temporarily unavailable', ECONNRESET: 'connection reset',
      ETIMEDOUT: 'connection timed out', UND_ERR_CONNECT_TIMEOUT: 'connection timed out',
      TimeoutError: 'request timed out', DEPTH_ZERO_SELF_SIGNED_CERT: 'untrusted TLS certificate',
      UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'TLS certificate verification failed',
    };
    throw new SafeFailure(reasons[error.cause?.code || error.code || error.name] || 'connection failed; check network, TLS, and endpoint configuration');
  }
}

async function json(response) {
  try { return await response.json(); }
  catch { throw new SafeFailure('response is not valid JSON'); }
}

function rowsFrom(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return null;
  for (const key of ['items', 'records', 'rows', 'results', 'list', 'data']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return rowsFrom(payload.data) || rowsFrom(payload.result);
}

// Node isolates test files: .env and real TapData requests stay in this process.
test('real TapData published APIs', async t => {
  const started = performance.now();
  let apis = [], passed = 0, failed = 0, untested = 0, token, configuration;
  const run = async (name, action) => {
    let ok = false;
    await t.test(name, async subtest => {
      const start = performance.now();
      try {
        const detail = await action();
        ok = true;
        subtest.diagnostic(`PASS | ${name} | ${(performance.now() - start).toFixed(1)} ms | ${detail}`);
      } catch (error) {
        // Only our controlled messages reach output; never upstream bodies or URLs.
        const detail = error instanceof SafeFailure ? error.message : 'could not complete check; verify TapData configuration';
        subtest.diagnostic(`FAIL | ${name} | ${(performance.now() - start).toFixed(1)} ms | ${detail}`);
        assert.fail(detail);
      }
    });
    return ok;
  };

  try {
    const discovered = await run('TapData API discovery', async () => {
      try { loadEnvFile(new URL('../.env', import.meta.url)); }
      catch { throw new SafeFailure('Cannot load .env; configured APIs could not be discovered or tested'); }
      let map;
      try { map = JSON.parse(process.env.TAPDATA_COLLECTION_MAP || '{}'); }
      catch { throw new SafeFailure('Invalid TAPDATA_COLLECTION_MAP JSON; configured APIs could not be discovered'); }
      requireValue(map && typeof map === 'object' && !Array.isArray(map), 'TAPDATA_COLLECTION_MAP must be a JSON object; APIs could not be discovered');

      // Include client default routes plus EVERY explicit mapping, including
      // custom services. Nested Customer 360 entities are not published routes.
      const source = await readFile(new URL('../src/integrations/tapdata/client.js', import.meta.url), 'utf8');
      const declaration = source.match(/const publishedTables=\[([^\]]+)\]/);
      requireValue(declaration, 'Client published API list could not be discovered; coverage is incomplete');
      const defaults = ['CUSTOMER', ...Array.from(declaration[1].matchAll(/'([A-Z_]+)'/g), match => match[1])];
      requireValue(defaults.length > 1, 'Client published API list is empty; coverage is incomplete');
      const names = defaults.map(table => map[table] ?? map[table.toLowerCase()] ?? table);
      names.push(...Object.values(map));
      const invalid = names.filter(name => typeof name !== 'string' || !/^[A-Za-z0-9_.-]{1,120}$/.test(name));
      apis = [...new Set(names.filter(name => !invalid.includes(name)))];
      requireValue(!invalid.length, `${invalid.length} configured API mappings are invalid and could not be discovered or tested`);
      requireValue(apis.length > 0, 'No published APIs discovered');
      const base = process.env.TAPDATA_API_BASE_URL || process.env.BANKING_API_BASE_URL;
      const template = process.env.TAPDATA_FIND_PATH_TEMPLATE;
      requireValue(base && template, 'Missing API base URL or path template; discovered APIs cannot be tested');
      requireValue(template.includes('{collection}') && !template.replaceAll('{collection}', '').includes('{'), 'Invalid TAPDATA_FIND_PATH_TEMPLATE');
      const method = (process.env.TAPDATA_FIND_METHOD || 'POST').toUpperCase();
      const style = process.env.TAPDATA_FIND_REQUEST_STYLE || 'body';
      requireValue(['GET', 'POST'].includes(method) && ['query', 'body'].includes(style) && !(method === 'GET' && style === 'body'), 'Invalid TapData find method or request style');
      let filter;
      try { filter = JSON.parse(process.env.TAPDATA_FIND_FILTER || '{}'); }
      catch { throw new SafeFailure('Invalid TAPDATA_FIND_FILTER JSON'); }
      requireValue(filter && typeof filter === 'object' && !Array.isArray(filter), 'TAPDATA_FIND_FILTER must be a JSON object');
      const timeout = Number(process.env.TAPDATA_REQUEST_TIMEOUT_MS || 15000);
      const pageSize = Number(process.env.TAPDATA_PAGE_SIZE || 200);
      requireValue(Number.isInteger(timeout) && timeout > 0 && Number.isInteger(pageSize) && pageSize > 0, 'Invalid TapData timeout or page size');
      configuration = { base, template, method, style, filter, timeout, pageSize };
      return `${apis.length} unique published APIs discovered from client defaults and .env mappings; unlisted workspace APIs cannot be discovered from this configuration`;
    });

    await run('TapData OAuth authentication', async () => {
      for (const key of ['TAPDATA_TOKEN_URL', 'TAPDATA_CLIENT_ID', 'TAPDATA_CLIENT_SECRET']) {
        requireValue(process.env[key], `Missing required configuration: ${key}`);
      }
      const form = new URLSearchParams({ grant_type: 'client_credentials' });
      const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
      const method = process.env.TAPDATA_TOKEN_AUTH_METHOD || 'client_secret_post';
      requireValue(['client_secret_post', 'client_secret_basic'].includes(method), 'Unsupported TAPDATA_TOKEN_AUTH_METHOD');
      if (method === 'client_secret_basic') {
        headers.Authorization = `Basic ${Buffer.from(`${process.env.TAPDATA_CLIENT_ID}:${process.env.TAPDATA_CLIENT_SECRET}`).toString('base64')}`;
      } else {
        form.set('client_id', process.env.TAPDATA_CLIENT_ID);
        form.set('client_secret', process.env.TAPDATA_CLIENT_SECRET);
      }
      const response = await request(process.env.TAPDATA_TOKEN_URL, { method: 'POST', headers, body: form }, configuration?.timeout || 15000);
      requireValue(response.ok, `OAuth HTTP ${response.status}; check credentials and authentication method`);
      const payload = await json(response);
      requireValue(typeof payload?.access_token === 'string' && payload.access_token.trim().length > 0, 'OAuth response has no valid access_token');
      token = payload.access_token;
      return `HTTP ${response.status}; fresh access token received`;
    });

    // Continue after failures so every discovered API gets its own result.
    for (const name of apis) {
      const ok = await run(`API ${name}`, async () => {
        if (!discovered || !token) {
          untested++;
          throw new SafeFailure(`NOT TESTED: ${!discovered ? 'endpoint discovery/configuration' : 'OAuth authentication'} failed`);
        }
        const { base, template, method, style, filter, timeout, pageSize } = configuration;
        const url = new URL(template.replaceAll('{collection}', encodeURIComponent(name)), base);
        const headers = { Accept: 'application/json', Authorization: `Bearer ${token}` };
        let body;
        if (style === 'query') url.searchParams.set('filter', JSON.stringify({ ...filter, limit: pageSize, skip: 0 }));
        else {
          headers['Content-Type'] = 'application/json';
          body = JSON.stringify({ filter, page: 1, pageSize });
        }
        const response = await request(url, { method, headers, ...(body ? { body } : {}) }, timeout);
        requireValue(response.ok, `HTTP ${response.status}${[401, 403].includes(response.status) ? '; OAuth token rejected or permission denied' : response.status === 404 ? '; published endpoint not found' : '; published API request failed'}`);
        const rows = rowsFrom(await json(response));
        requireValue(rows !== null, `HTTP ${response.status}; response has no recognized records array`);
        requireValue(rows.length > 0, `HTTP ${response.status}; no records retrieved; check API publication and configured filter`);
        requireValue(rows.every(row => row && typeof row === 'object' && !Array.isArray(row) && Object.keys(row).length > 0), `HTTP ${response.status}; response contains invalid or empty records`);
        return `HTTP ${response.status}; authenticated; ${rows.length} valid records retrieved (first page)`;
      });
      if (ok) passed++; else failed++;
    }
  } finally {
    t.diagnostic(`TapData API summary | total APIs: ${apis.length} | passed: ${passed} | failed: ${failed} | not tested: ${untested} | execution duration: ${(performance.now() - started).toFixed(1)} ms`);
    if (!configuration) t.diagnostic('FAIL: API discovery/configuration incomplete; full endpoint coverage could not be established');
  }
});
