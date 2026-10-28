import { performance } from 'node:perf_hooks';
import { logger, requestContext, newRequestId } from '../utils/logger.js';

export function requestLogging(req, res, next) {
  if (!/^\/api(?:\/|\?|$)/.test(req.originalUrl)) return next();
  const requestId = newRequestId(), start = performance.now(), startedAt = new Date().toISOString();
  res.setHeader('X-Request-ID', requestId);
  requestContext.run({ requestId, polling: req.path === '/api/dashboard' }, () => {
    logger.debug('Dashboard API request started', { event: 'http.start', requestId, method: req.method, startedAt });
    let completed = false;
    const finish = () => {
      if (completed) return;
      completed = true;
      const status = res.writableFinished ? res.statusCode : 499;
      // Express route templates exclude customer IDs; no query strings are logged.
      const endpoint = req.route?.path ? `${req.route.path.startsWith('/api/') ? '' : '/api'}${req.route.path}` : '/api/[unmatched]';
      const polling = endpoint === '/api/dashboard';
      logger[status >= 500 ? 'error' : status >= 400 ? 'warn' : polling ? 'debug' : 'info']('Dashboard API request completed', {
        event: polling ? 'poll.complete' : 'http.complete', requestId, method: req.method, endpoint, status, startedAt,
        durationMs: Math.round((performance.now() - start) * 100) / 100, success: status < 400, error: res.locals.logError });
    };
    res.once('finish', finish);
    res.once('close', finish);
    next();
  });
}
