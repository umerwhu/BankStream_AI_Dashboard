import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';

export const requestContext = new AsyncLocalStorage();
const positive = (value, fallback) => Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
// Do not serialize arbitrary messages, payloads, headers, URLs or error messages.
// Error messages can contain SQL, tokens, or customer data; retain stack frames only.
export function safeError(error) {
  return { name: ['Error','TypeError','SyntaxError','TimeoutError','AbortError','HttpError'].includes(error?.name) ? error.name : 'Error',
    code: /^[A-Z_0-9]{1,60}$/.test(error?.code || '') ? error.code : undefined,
    stack: String(error?.stack || '').split('\n').slice(1).filter(line => /^\s+at /.test(line)).map(line => line.replace(/\([^)]*\)/g, '(location redacted)')).join('\n') };
}

export function formatLogEntry(info) {
  const { timestamp, level, message, apiName, method, endpoint, status, durationMs, requestId, ...metadata } = info;
  const value = item => typeof item === 'string' ? JSON.stringify(item).slice(1, -1) : JSON.stringify(item);
  const parts = [`${timestamp} ${level.toUpperCase()}: ${value(message)}`];
  if (apiName !== undefined) parts.push(`API: ${value(apiName)}`);
  if (method && endpoint) parts.push(`${value(method)} ${value(endpoint)}`);
  else {
    if (method !== undefined) parts.push(`Method: ${value(method)}`);
    if (endpoint !== undefined) parts.push(`Endpoint: ${value(endpoint)}`);
  }
  if (status !== undefined) parts.push(`Status: ${value(status)}`);
  if (durationMs !== undefined) parts.push(`Duration: ${value(durationMs)}${durationMs === null ? '' : 'ms'}`);
  if (requestId !== undefined) parts.push(`RequestID: ${value(requestId)}`);
  for (const [key, item] of Object.entries(metadata)) {
    if (item !== undefined) parts.push(`${key[0].toUpperCase()}${key.slice(1)}: ${value(item)}`);
  }
  return parts.join(' | ');
}

export function createLogger({ directory = process.env.LOG_DIR || './logs', level = process.env.LOG_LEVEL || 'info', retentionDays = positive(process.env.LOG_RETENTION_DAYS, 14), maxSize = process.env.LOG_MAX_SIZE || '10m', maxFiles = positive(process.env.LOG_MAX_FILES, 100), console = true } = {}) {
  directory = path.resolve(directory);
  mkdirSync(path.join(directory, 'archived'), { recursive: true });
  const transports = [];
  for (const name of ['application', 'error']) {
    const transport = new DailyRotateFile({ dirname: path.join(directory, 'archived'), filename: `${name}-%DATE%.log`, datePattern: 'YYYY-MM-DD', utc: true, maxSize, maxFiles,
      auditFile: path.join(directory, `.${name}-audit.json`), level: name === 'error' ? 'error' : ['warn','error'].includes(level) ? level : 'info' });
    const prune = () => {
      try {
        const retained = [];
        for (const file of readdirSync(path.join(directory, 'archived'))) {
          if (!file.startsWith(`${name}-`) || !/^(application|error)-[\d-]+\.log(?:\.\d+)?$/.test(file)) continue;
          const target = path.join(directory, 'archived', file);
          const modified = statSync(target).mtimeMs;
          if (Date.now() - modified > retentionDays * 86400000) unlinkSync(target);
          else retained.push({ target, modified });
        }
        retained.sort((a,b) => b.modified - a.modified || b.target.localeCompare(a.target, undefined, { numeric: true }));
        for (const file of retained.slice(maxFiles)) unlinkSync(file.target);
      } catch { process.stderr.write('Log retention cleanup failed\n'); }
    };
    transport.on('rotate', prune);
    transport.on('new', () => { const timer = setTimeout(prune, 50); timer.unref(); });
    transport.on('error', () => process.stderr.write('Log file transport failed\n'));
    prune();
    transports.push(transport);
  }
  if (console) transports.push(new winston.transports.Console({ level }));
  const logger = winston.createLogger({ level: ['debug','info','warn','error'].includes(level) ? level : 'info', format: winston.format.combine(winston.format(info => {
    Object.assign(info, { timestamp: new Date().toISOString(), environment: process.env.NODE_ENV || 'development', pid: process.pid,
      requestId: requestContext.getStore()?.requestId || info.requestId || null,
      method: info.method || null, endpoint: info.endpoint || null, status: info.status ?? null, durationMs: info.durationMs ?? null });
    return info;
  })(), winston.format.printf(formatLogEntry)), transports });
  logger.on('error', () => process.stderr.write('Logging failed\n'));
  return logger;
}
export const logger = createLogger();
export const newRequestId = () => randomUUID();
