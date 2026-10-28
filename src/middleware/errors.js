import { safeError } from '../utils/logger.js';
export class HttpError extends Error {
  constructor(status, message, code = 'REQUEST_FAILED') { super(message); this.status = status; this.code = code; }
}
export function notFound(_req, _res, next) { next(new HttpError(404, 'Resource not found', 'NOT_FOUND')); }
export function errorHandler(err, _req, res, _next) {
  const status = Number(err.status) || 500;
  res.locals.logError = safeError(err);
  res.status(status).json({ error: { code: err.code || 'INTERNAL_ERROR', message: status >= 500 ? 'The request could not be completed' : err.message } });
}
