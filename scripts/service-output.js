import { networkRows } from './network-addresses.js';

const colorEnabled = process.env.FORCE_COLOR !== '0' && !process.env.NO_COLOR && (process.stdout.isTTY || Boolean(process.env.FORCE_COLOR));
const paint = (code, text) => colorEnabled ? `\x1b[${code}m${text}\x1b[0m` : text;
export const formatLine = (label, value) => `${label.padEnd(15)}:  ${value}`;
const utc = date => date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
const safeText = value => String(value).replace(/[\x00-\x1f\x7f-\x9f]/g, '');

export function serviceScreen({ action, outcome, pid, environment, host = '127.0.0.1', port, logsDir, durationMs, startedAt, tapdata, aiProvider, logLevel, error, interfaces }) {
  const start = action === 'start', status = action === 'status', success = outcome === 'success';
  const online = start || (status && success);
  const indicator = error ? '[!]' : success ? online ? '[✓]' : '[■]' : status ? '[■]' : '[i]';
  const statusColor = error ? 91 : status ? success ? 92 : 91 : success ? start ? 92 : 91 : 93;
  const lines = [paint(96, `◆ SYSTEM ${status ? 'STATUS' : start ? 'INITIALIZATION' : 'SHUTDOWN'} ◆`),
    paint(96, '       /-----\\'), paint(96, '       | ') + paint(statusColor, indicator) + paint(96, ' |'), paint(96, '        \\___/'),
    paint(96, '   BANKSTREAM_AI_DASHBOARD'), paint(94, 'REAL-TIME BANKING INTELLIGENCE SYSTEM'), ''];
  const result = status ? success ? 'SYSTEM ONLINE — SERVICE RUNNING' : 'SYSTEM OFFLINE — SERVICE STOPPED' : error ? `${start ? 'STARTUP' : 'SHUTDOWN'} FAILED — ${safeText(error.message)}` : success ? start ? 'SYSTEM ONLINE — STARTUP VERIFIED' : 'SYSTEM OFFLINE — SHUTDOWN COMPLETED' : start ? 'SERVICE ALREADY RUNNING — NO NEW PROCESS STARTED' : 'SERVICE ALREADY STOPPED — NO SHUTDOWN REQUIRED';
  lines.push(paint(statusColor, `${indicator} ${result}`), '');
  const section = (title, rows) => {
    lines.push(paint(94, title), paint(96, '------------------------------------------------'));
    for (const [label, value] of rows) lines.push(formatLine(label, paint(label === 'Status' ? statusColor : 96, safeText(value))));
    lines.push('');
  };
  const network = networkRows(host, port, interfaces);
  section('APPLICATION STATUS', [
    ['Application', 'BankStream AI Dashboard'], ['Status', error ? 'FAILED' : online ? 'RUNNING' : 'STOPPED'],
    ['Environment', ({ development: 'Development', production: 'Production', test: 'Test' })[environment] || environment],
    ...(status ? [] : [[start ? 'Started At' : 'Stopped At', error ? 'Not completed' : start && startedAt ? utc(new Date(startedAt)) : outcome === 'already' ? 'Not available' : utc(new Date())]]),
    ['Process ID', pid ?? 'None'], ...network.filter(([label]) => !status || label !== 'LAN URL')]);
  if (status) section('NETWORK ACCESS', [
    ...network.filter(([label]) => label === 'LAN URL').map(([, value], index) => {
      const match = value.match(/^(http:\/\/\S+) \((.*)\)$/);
      const label = match ? `LAN (${safeText(match[2])})` : 'LAN';
      return label.length <= 15 ? [label, match ? match[1] : value] : [`LAN ${index + 1}`, value];
    }),
    ['Network Mode', host === '0.0.0.0' ? 'LAN Enabled' : host === '::' ? 'IPv6 wildcard' : ['localhost','::1'].includes(host) || host.startsWith('127.') ? 'Localhost only' : 'Specific host']]);
  section('SERVICE INFORMATION', [['Backend', 'Node.js'], ...(start || status ? [['TapData API', tapdata ? 'Configured' : 'Not configured'], ['AI Provider', ({ deepseek: 'DeepSeek', openai: 'OpenAI' })[aiProvider] || aiProvider], ['Log Level', logLevel]] : [['Shutdown', success ? 'Process exit verified; graceful completion unverified' : 'Not performed']]),
    ['Log Directory', logsDir], ...(status ? [] : [[outcome === 'already' ? 'Check Time' : start ? 'Startup Time' : 'Shutdown Time', `${durationMs}ms`]])]);
  section('COMMANDS', status ? [['Start', 'npm run service:start'], ['Stop', 'npm stop'], ['Restart', 'npm run service:restart']] : [[start ? 'Stop' : 'Start', start ? 'npm stop' : 'npm run service:start'], ['Status', 'npm run service:status'], ['Restart', 'npm run service:restart']]);
  lines.push(paint(96, '------------------------------------------------'), paint(error ? 91 : 96, `◆ BANKSTREAM INTELLIGENCE ENGINE ${error ? 'FAILED' : status ? success ? 'ACTIVE' : 'STOPPED' : start ? 'READY' : 'STOPPED'} ◆`));
  return lines.join('\n');
}
