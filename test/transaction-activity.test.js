import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTransactionActivity, timestampMs } from '../src/utils/transaction-activity.js';

const at = minutes => new Date(Date.UTC(2026, 0, 2, 12) - minutes * 60_000).toISOString();
const tx = (id, minutes, stage = 'POSTED', status = 'COMPLETED', extra = {}) => ({
  TRANSACTION_ID: id, TRANSACTION_TIMESTAMP: at(minutes), TRANSACTION_STAGE: stage,
  TRANSACTION_STATUS: status, TRANSACTION_TYPE: 'TRANSFER', ...extra,
});

test('rolling window uses one UTC instant, includes its endpoints, and excludes future/old records', () => {
  const now = Date.UTC(2026, 0, 2, 12);
  const rows = [tx('start', 1440), tx('inside', 1439), tx('now', 0), tx('future', -1), tx('old', 1441)];
  const result = buildTransactionActivity(rows, now);
  assert.equal(result.recentCount24h, 3);
  assert.equal(result.series.reduce((sum, x) => sum + Object.values(x.counts).reduce((n, value) => n + value, 0), 0), result.recentCount24h);
  assert.equal(result.series.length, 12);
  assert.equal(result.series[0].start, new Date(now - 86_400_000).toISOString());
  assert.equal(result.series.at(-1).end, new Date(now).toISOString());
});

test('counts all stages and statuses in KPI and chart while preserving separate posted-completion data', () => {
  const now = Date.UTC(2026, 0, 2, 12);
  const rows = [
    tx('posted', 20), tx('auth-complete', 30, 'AUTHORIZATION', 'COMPLETED'),
    tx('auth-rejected', 40, 'AUTHORIZATION', 'REJECTED'),
    tx('posted-rejected', 50, 'POSTED', 'REJECTED'),
    tx('original-reversed', 60),
    tx('reversal', 10, 'REVERSAL', 'REVERSED', { TRANSACTION_TYPE: 'REVERSAL', RELATED_TRANSACTION_ID: 'original-reversed' }),
    tx('pending-authorization', 70, 'AUTHORIZATION', 'PENDING'),
    tx('cancelled-posting', 80, 'POSTED', 'CANCELLED'),
  ];
  const result = buildTransactionActivity(rows, now);
  assert.equal(result.recentCount24h, 8);
  assert.equal(result.postedTransactions.length, 1);
  const chartStatusTotals = result.series.reduce((totals, bucket) => {
    for (const [status, count] of Object.entries(bucket.counts)) totals[status] = (totals[status] || 0) + count;
    return totals;
  }, {});
  assert.deepEqual(chartStatusTotals, { COMPLETED: 3, REJECTED: 2, REVERSED: 1, PENDING: 1, CANCELLED: 1 });
  assert.equal(Object.values(chartStatusTotals).reduce((sum, count) => sum + count, 0), result.recentCount24h);
});

test('interprets TapData-shifted source timestamps using the returned timezone offset', () => {
  const now = Date.UTC(2026, 0, 2, 4);
  const row = {
    ...tx('as400-local-time', 0),
    TRANSACTION_TIMESTAMP: '2026-01-02T19:00:00+08:00',
  };
  const result = buildTransactionActivity([row], now);
  assert.equal(result.recentCount24h, 1);
  assert.equal(result.series.reduce((sum, x) => sum + Object.values(x.counts).reduce((n, value) => n + value, 0), 0), 1);
});

test('deduplicates repeated transaction IDs and rejects timezone-ambiguous or invalid timestamps', () => {
  const now = Date.UTC(2026, 0, 2, 12);
  const result = buildTransactionActivity([
    tx('duplicate', 10), tx('duplicate', 10),
    { ...tx('naive', 5), TRANSACTION_TIMESTAMP: '2026-01-02 11:55:00' },
    { ...tx('invalid', 5), TRANSACTION_TIMESTAMP: 'not a date' },
  ], now);
  assert.equal(result.transactions.length, 3);
  assert.equal(result.recentCount24h, 1);
  assert.equal(result.series.reduce((sum, x) => sum + Object.values(x.counts).reduce((n, value) => n + value, 0), 0), 1);
  assert.equal(timestampMs('2026-01-02T12:00:00Z'), now);
  assert.equal(timestampMs('2026-01-02 12:00:00'), null);
});
