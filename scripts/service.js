import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
const logsDir = path.join(stateDir, 'logs');
const pidFile = path.join(stateDir, 'dashboard.pid');
const stdoutFile = path.join(logsDir, 'dashboard.log');
const stderrFile = path.join(logsDir, 'dashboard-error.log');
const port = process.env.PORT || fileEnv.PORT || '3001';

function getPid() {
  try {
    const pid = Number(JSON.parse(readFileSync(pidFile, 'utf8')).pid);
    if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid PID record');
    process.kill(pid, 0);
    return pid;
  } catch {
    rmSync(pidFile, { force: true });
    return null;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stop() {
  const pid = getPid();
  if (!pid) {
    console.log('BankStream Dashboard is stopped.');
    return;
  }
  process.kill(pid, 'SIGTERM');
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await sleep(100);
    try { process.kill(pid, 0); } catch {
      rmSync(pidFile, { force: true });
      console.log(`Stopped BankStream Dashboard (PID ${pid}).`);
      return;
    }
  }
  throw new Error(`Dashboard process ${pid} did not stop. Check its status and stop it through your host process manager.`);
}

async function start() {
  const existingPid = getPid();
  if (existingPid) {
    console.log(`BankStream Dashboard is already running (PID ${existingPid}, port ${port}).`);
    return;
  }
  mkdirSync(logsDir, { recursive: true });
  const stdout = openSync(stdoutFile, 'a');
  const stderr = openSync(stderrFile, 'a');
  const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'server.js'], {
    cwd: projectRoot,
    detached: true,
    stdio: ['ignore', stdout, stderr],
    env: process.env,
  });
  closeSync(stdout);
  closeSync(stderr);
  child.unref();
  if (child.pid === undefined) throw new Error('Could not start the dashboard process.');
  writeFileSync(pidFile, JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString(), port }, null, 2));
  await sleep(1000);
  try {
    process.kill(child.pid, 0);
  } catch {
    rmSync(pidFile, { force: true });
    const errors = existsSync(stderrFile) ? readFileSync(stderrFile, 'utf8').split(/\r?\n/).slice(-12).join('\n') : '';
    throw new Error(`Dashboard exited during startup.${errors ? ` Check ${stderrFile}:\n${errors}` : ''}`);
  }
  console.log(`Started BankStream Dashboard in the background (PID ${child.pid}, port ${port}).`);
  console.log(`URL: http://127.0.0.1:${port}/`);
  console.log(`Logs: ${stdoutFile} and ${stderrFile}`);
}

async function showLogs() {
  for (const file of [stdoutFile, stderrFile]) {
    if (!existsSync(file)) continue;
    const lines = readFileSync(file, 'utf8').trimEnd().split(/\r?\n/);
    console.log(`\n--- ${path.basename(file)} ---`);
    console.log(lines.slice(-80).join('\n'));
  }
  if (!existsSync(stdoutFile) && !existsSync(stderrFile)) console.log('No dashboard logs found yet.');
}

const action = (process.argv[2] || 'status').toLowerCase();
if (action === 'start') await start();
else if (action === 'stop') await stop();
else if (action === 'restart') { await stop(); await start(); }
else if (action === 'status') {
  const pid = getPid();
  console.log(pid ? `BankStream Dashboard is running (PID ${pid}, port ${port}). URL: http://127.0.0.1:${port}/` : `BankStream Dashboard is stopped (configured port ${port}).`);
} else if (action === 'logs') await showLogs();
else throw new Error('Use one of: start, stop, restart, status, logs.');
