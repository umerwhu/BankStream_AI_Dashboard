import { performance } from 'node:perf_hooks';
import { logger, safeError, requestContext, newRequestId } from './logger.js';

// The endpoint is a trusted route template supplied by the caller, never a raw URL.
export async function loggedFetch(url, options, { apiName, endpoint, attempt = 0, maxAttempts = 1 }) {
  const start = performance.now(), startedAt = new Date().toISOString();
  const fields = { apiName, endpoint, method: options.method || 'GET', attempt: attempt + 1, startedAt,
    requestId: requestContext.getStore()?.requestId || newRequestId() };
  logger.debug('Downstream API request started', { ...fields, event: 'upstream.start' });
  try {
    const response = await fetch(url, options);
    const retry = [429,502,503,504].includes(response.status) && attempt + 1 < maxAttempts;
    logger[response.ok ? (requestContext.getStore()?.polling ? 'debug' : 'info') : 'warn']('Downstream API response received', { ...fields, event: 'upstream.complete', status: response.status, durationMs: Math.round((performance.now() - start) * 100) / 100, success: response.ok, retry });
    return response;
  } catch (error) {
    logger.warn('Downstream API request failed', { ...fields, event: 'upstream.failure', durationMs: Math.round((performance.now() - start) * 100) / 100,
      success: false, timeout: ['TimeoutError','AbortError'].includes(error?.name), retry: attempt + 1 < maxAttempts, error: safeError(error) });
    throw error;
  }
}
