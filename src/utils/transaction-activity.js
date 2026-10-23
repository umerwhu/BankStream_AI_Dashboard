const DAY_MS = 24 * 60 * 60 * 1000;
const BUCKET_MS = 2 * 60 * 60 * 1000;
const BUCKET_COUNT = 12;

function timestampMs(value) {
  if (typeof value !== 'string' || !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value.trim())) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueTransactions(rows) {
  const byId = new Map();
  for (const row of rows) {
    const id = row?.TRANSACTION_ID;
    if (id === undefined || id === null || String(id).trim() === '') continue;
    const key = String(id);
    const previous = byId.get(key);
    const currentUpdated = timestampMs(row.LAST_UPDATED_TIMESTAMP) ?? -Infinity;
    const previousUpdated = timestampMs(previous?.LAST_UPDATED_TIMESTAMP) ?? -Infinity;
    if (!previous || currentUpdated >= previousUpdated) byId.set(key, row);
  }
  return [...byId.values()];
}

function isReversal(row) {
  return row.TRANSACTION_STAGE === 'REVERSAL'
    || row.TRANSACTION_STATUS === 'REVERSED'
    || row.TRANSACTION_TYPE === 'REVERSAL';
}

export function buildTransactionActivity(rows = [], now = Date.now()) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const endMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const startMs = endMs - DAY_MS;
  const unique = uniqueTransactions(rows);
  const reversalLinked = new Set(unique.filter(isReversal).map(x => x.RELATED_TRANSACTION_ID).filter(Boolean).map(String));
  const eligiblePosted = unique.filter(x => x.TRANSACTION_STAGE === 'POSTED'
    && x.TRANSACTION_STATUS === 'COMPLETED'
    && x.TRANSACTION_TYPE !== 'REVERSAL'
    && !reversalLinked.has(String(x.TRANSACTION_ID)));
  const recentTransactions = unique.filter(x => {
    const time = timestampMs(x.TRANSACTION_TIMESTAMP);
    return time !== null && time >= startMs && time <= endMs;
  });
  const buckets = Array.from({ length: BUCKET_COUNT }, (_, index) => {
    const start = startMs + index * BUCKET_MS;
    const end = start + BUCKET_MS;
    return { start: new Date(start).toISOString(), end: new Date(end).toISOString(), counts: {} };
  });
  const statusTotals = new Map();
  for (const row of recentTransactions) {
    const time = timestampMs(row.TRANSACTION_TIMESTAMP);
    const index = Math.min(BUCKET_COUNT - 1, Math.floor((time - startMs) / BUCKET_MS));
    const status = String(row.TRANSACTION_STATUS || 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN';
    buckets[index].counts[status] = (buckets[index].counts[status] || 0) + 1;
    statusTotals.set(status, (statusTotals.get(status) || 0) + 1);
  }
  return { transactions: unique, postedTransactions: eligiblePosted, recentCount24h: recentTransactions.length, statuses: [...statusTotals].map(([label, count]) => ({ label, count })), series: buckets, windowStart: new Date(startMs).toISOString(), windowEnd: new Date(endMs).toISOString() };
}

export { timestampMs };
