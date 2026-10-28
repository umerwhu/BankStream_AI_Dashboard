import test from 'node:test';
import assert from 'node:assert/strict';

test('dashboard auto-refresh forces a new TapData bundle despite the configured 15-second cache', async () => {
  Object.assign(process.env, {
    DATA_SOURCE: 'tapdata',
    TAPDATA_API_BASE_URL: 'https://tapdata.refresh-test',
    TAPDATA_FIND_PATH_TEMPLATE: '/api/v1/{collection}',
    TAPDATA_COLLECTION_MAP: '{"CUSTOMER":"MDM_CUSTOMER360"}',
    TAPDATA_ACCESS_TOKEN: 'test-token',
    TAPDATA_FIND_METHOD: 'GET',
    TAPDATA_FIND_REQUEST_STYLE: 'query',
    TAPDATA_FIND_FILTER: '{}',
    TAPDATA_PAGE_SIZE: '200',
    TAPDATA_SCAN_LIMIT: '1000',
    TAPDATA_REQUEST_TIMEOUT_MS: '1000',
    TAPDATA_CACHE_TTL_MS: '15000'
  });
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async input => {
    const url = new URL(input);
    requestCount++;
    const data = url.pathname.endsWith('/MDM_CUSTOMER360')
      ? [{ CUSTOMER_ID: 'C-1', ACCOUNT_CUSTOMER_RELATIONSHIP: [] }]
      : [];
    return Response.json({ data, total: data.length });
  };

  try {
    const { fraudIntelligenceService } = await import(`../src/services/fraud-intelligence-service.js?refresh-test=${Date.now()}`);
    const dashboardSource = await import('node:fs/promises').then(fs => fs.readFile(new URL('../public/js/dashboard.js', import.meta.url), 'utf8'));
    assert.match(dashboardSource, /setInterval\(\(\)=>\{if\(!document\.hidden\)loadAll\(\{forceFresh:true\}\);\},Number\(interval\)\)/);
    assert.match(dashboardSource, /allowed=new Set\(\['0','2000','10000','30000','60000'\]\)/);
    assert.match(dashboardSource, /if\(interval!=='0'\)state\.refreshTimer=setInterval/);

    await fraudIntelligenceService.getSourceBundle({ all: true });
    const firstFetchCount = requestCount;
    assert.ok(firstFetchCount > 1, 'initial bundle should fetch the published services');

    await fraudIntelligenceService.getSourceBundle({ all: true });
    assert.equal(requestCount, firstFetchCount, 'unforced reads should reuse the normal cache');

    let expectedFetchCount = firstFetchCount;
    for (const interval of [2000, 10000, 30000, 60000]) {
      fraudIntelligenceService.refreshSource();
      await fraudIntelligenceService.getSourceBundle({ all: true });
      expectedFetchCount += firstFetchCount;
      assert.equal(requestCount, expectedFetchCount,
        `selected ${interval / 1000}-second refresh should fetch a fresh bundle`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
