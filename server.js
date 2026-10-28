import app from './src/app.js';
import { env } from './src/config/env.js';
import { logger, safeError } from './src/utils/logger.js';

if (env.nodeEnv !== 'test') {
  const server = app.listen(env.port, env.host);
  server.once('listening', () => logger.info('BankStream Intelligence listening', { event: 'application.start', host: env.host, port: env.port }));
  server.on('error', error => {
    logger.error('BankStream could not listen', { event: 'application.listen_error', host: env.host, port: env.port, error: safeError(error) });
    process.exitCode = 1;
  });
  let stopping = false;
  const shutdown = (signal, exitCode = 0) => {
    if (stopping) return;
    stopping = true;
    logger.info('Graceful shutdown started', { event: 'application.shutdown_start', signal });
    const deadline = setTimeout(() => process.exit(1), 10000);
    deadline.unref();
    server.close(() => {
      logger.info('Graceful shutdown completed', { event: 'application.shutdown_complete', signal });
      logger.once('finish', () => { clearTimeout(deadline); process.exit(exitCode); });
      logger.end();
    });
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('uncaughtException', error => {
    logger.error('Unexpected process exception', { event: 'process.uncaught_exception', error: safeError(error) });
    shutdown('uncaughtException', 1);
  });
  process.once('unhandledRejection', error => {
    logger.error('Unhandled process rejection', { event: 'process.unhandled_rejection', error: safeError(error) });
    shutdown('unhandledRejection', 1);
  });
}
export default app;
