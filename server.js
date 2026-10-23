import app from './src/app.js';
import { env } from './src/config/env.js';

if (env.nodeEnv !== 'test') {
  const server = app.listen(env.port, '127.0.0.1');
  server.once('listening', () => console.log(`BankStream Intelligence listening at http://127.0.0.1:${env.port} (${env.nodeEnv})`));
  server.on('error', error => {
    console.error(`BankStream could not listen on 127.0.0.1:${env.port}: ${error.code || 'ERROR'}: ${error.message}`);
    process.exitCode = 1;
  });
}
export default app;
