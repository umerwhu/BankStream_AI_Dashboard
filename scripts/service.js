import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createConnection } from 'node:net';
import { serviceScreen } from './service-output.js';
import { probeHost } from './network-addresses.js';
import { confirmShutdown } from './confirm-shutdown.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const envFile = path.join(projectRoot, '.env');

function readEnvFile() {
  if (!existsSync(envFile)) return {};
  return Object.fromEntries(readFileSync(envFile, 'utf8').split(/\r?\n/)
    .map((line) => line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/))
    .filter(Boolean)
    .map(([, key, value]) => [key, value.replace(/^(?:"(.*)"|'(.*)')$/, (_, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted)]));
}

const fileEnv = readEnvFile();
const stateDir = path.resolve(projectRoot, process.env.STATE_DIR || fileEnv.STATE_DIR || 'var');
const logsDir = path.resolve(projectRoot, process.env.LOG_DIR || fileEnv.LOG_DIR || 'logs');
const pidFile = path.join(stateDir, 'dashboard.pid');
const port = process.env.PORT || fileEnv.PORT || '3001';
const host = process.env.HOST || fileEnv.HOST || '127.0.0.1';
const setting = (name, fallback = '') => process.env[name] || fileEnv[name] || fallback;
function screen(action, outcome, began, details = {}) {
  console.log(serviceScreen({ action, outcome, environment: setting('NODE_ENV', 'development'), host, port,
    logsDir: setting('LOG_DIR', './logs/'), durationMs: Math.round(performance.now() - began),
    tapdata: Boolean(setting('TAPDATA_API_BASE_URL', setting('BANKING_API_BASE_URL')) && setting('TAPDATA_FIND_PATH_TEMPLATE')),
    aiProvider: setting('AI_PROVIDER', 'deepseek'), logLevel: setting('LOG_LEVEL', 'info').toUpperCase(), ...details }));
}
function verifyListening(binding = host, configuredPort = port) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: probeHost(binding), port: Number(configuredPort) });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve(); });
    socket.once('error', reject);
    socket.once('timeout', () => { socket.destroy(); reject(new Error('Startup verification timed out: server is not listening')); });
  });
}

function getPid() {
  let pid;
  try {
    pid = Number(JSON.parse(readFileSync(pidFile, 'utf8')).pid);
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid PID record');
  } catch (error) {
    if (error.code && error.code !== 'ENOENT') throw error;
    rmSync(pidFile, { force: true });
    return null;
  }
  try { process.kill(pid, 0); return pid; }
  catch (error) {
    if (error.code !== 'ESRCH') throw error;
    rmSync(pidFile, { force: true });
    return null;
  }
}

function startupFailure(pid) {
  // Read only the sanitized error code from this child's existing application log.
  const archive = path.join(logsDir, 'archived');
  if (existsSync(archive)) {
    for (const file of readdirSync(archive).filter(name => /^error-.*\.log(?:\.\d+)?$/.test(name)).sort().reverse()) {
      const line = readFileSync(path.join(archive, file), 'utf8').split(/\r?\n/).reverse().find(line =>
        line.includes('Event: application.listen_error') && new RegExp(`\\bPid: ${pid}(?: \\||$)`).test(line));
      const code = line?.match(/"code":"([A-Z_0-9]+)"/)?.[1];
      if (code) return new Error(`Dashboard could not listen on ${host}:${port}: ${code}`);
    }
  }
  return new Error(`Dashboard exited during startup. Check structured logs in ${logsDir}/archived.`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stop() {
  const began = performance.now();
  let pid;
  let record = {};
  try {
    pid = getPid();
    if (!pid) {
      screen('stop', 'already', began);
      return;
    }
    record = JSON.parse(readFileSync(pidFile, 'utf8'));
    process.kill(pid, 'SIGTERM');
    for (let attempt = 0; attempt < 50; attempt += 1) {
      await sleep(100);
      try { process.kill(pid, 0); } catch (error) {
        if (error.code !== 'ESRCH') throw error;
        rmSync(pidFile, { force: true });
        screen('stop', 'success', began, { pid, host: record.host || host, port: record.port || port });
        return;
      }
    }
    throw new Error(`Dashboard process ${pid} did not stop. Check its status and stop it through your host process manager.`);
  } catch (error) { screen('stop', 'failure', began, { error, pid, host: record.host || host, port: record.port || port }); process.exitCode = 1; return false; }
}

async function start() {
  const began = performance.now();
  let pid;
  try {
    const existingPid = getPid();
    pid = existingPid;
    if (existingPid) {
      const record = JSON.parse(readFileSync(pidFile, 'utf8'));
      await verifyListening(record.host || host, record.port || port);
      screen('start', 'already', began, { pid: existingPid, startedAt: record.startedAt, host: record.host || host, port: record.port || port });
      return;
    }
    mkdirSync(logsDir, { recursive: true });
    mkdirSync(stateDir, { recursive: true });
    const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'server.js'], {
      cwd: projectRoot,
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    child.unref();
    pid = child.pid;
    let spawnError;
    child.once('error', error => { spawnError = error; });
    if (child.pid === undefined) throw new Error('Could not start the dashboard process.');
    const startedAt = new Date().toISOString();
    writeFileSync(pidFile, JSON.stringify({ pid: child.pid, startedAt, host, port }, null, 2));
    await sleep(1000);
    if (spawnError) throw spawnError;
    try {
      process.kill(child.pid, 0);
    } catch (error) {
      if (error.code !== 'ESRCH') throw error;
      rmSync(pidFile, { force: true });
      throw startupFailure(child.pid);
    }
    await verifyListening();
    process.kill(child.pid, 0);
    screen('start', 'success', began, { pid: child.pid, startedAt });
  } catch (error) { screen('start', 'failure', began, { error, pid }); process.exitCode = 1; }
}

async function showLogs() {
  const archive = path.join(logsDir, 'archived');
  const files = existsSync(archive) ? readdirSync(archive).filter(name => /\.log(?:\.\d+)?$/.test(name)).sort().slice(-4).map(name => path.join(archive, name)) : [];
  for (const file of files) {
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, 'utf8').trimEnd().split(/\r?\n/);
    console.log(`\n--- ${path.basename(file)} ---`);
    console.log(lines.slice(-80).join('\n'));
  }
  if (!files.length) console.log('No dashboard logs found yet.');
}

const action = (process.argv[2] || 'status').toLowerCase();
if (action === 'start') await start();
else if (action === 'stop') {
  if (await confirmShutdown()) await stop();
  else console.log('Shutdown cancelled — dashboard is still running.');
}
else if (action === 'restart') { if (await stop() !== false) await start(); }
else if (action === 'status') {
  const pid = getPid();
  const record = pid ? JSON.parse(readFileSync(pidFile, 'utf8')) : {};
  const binding = record.host || host, configuredPort = record.port || port;
  screen('status', pid ? 'success' : 'already', performance.now(), { pid, host: binding, port: configuredPort });
} else if (action === 'logs') await showLogs();
else throw new Error('Use one of: start, stop, restart, status, logs.');
