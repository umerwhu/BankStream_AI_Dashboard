import { networkInterfaces } from 'node:os';

export const probeHost = host => host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host;
export const browserUrl = (host, port) => `http://${host.includes(':') ? `[${host}]` : host}:${port}/`;

export function networkRows(host, port, interfaces = networkInterfaces()) {
  const rows = [['Host', host], ['Port', port]];
  const local = ['0.0.0.0', '127.0.0.1', 'localhost', '::', '::1'].includes(host) || host.startsWith('127.');
  if (local) rows.push(['Local URL', browserUrl(probeHost(host), port)]);
  if (host === '0.0.0.0' || !local) {
    const addresses = Object.entries(interfaces).flatMap(([name, entries]) => (entries || [])
      .filter(entry => entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('169.254.') && (host === '0.0.0.0' || entry.address === host))
      .map(entry => [name, entry.address]));
    for (const [name, address] of addresses) rows.push(['LAN URL', `${browserUrl(address, port)} (${name})`]);
    if (!addresses.length) rows.push(['LAN URL', 'No matching LAN IPv4 interface detected']);
  }
  return rows;
}
