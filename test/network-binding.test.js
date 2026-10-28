import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { networkRows, probeHost } from '../scripts/network-addresses.js';
import { serviceScreen } from '../scripts/service-output.js';

const exec = promisify(execFile);
test('network presentation identifies each interface and only advertises enabled LAN bindings', () => {
  const interfaces = { Ethernet: [{family:'IPv4',internal:false,address:'192.168.1.10'}], WiFi: [{family:'IPv4',internal:false,address:'10.0.0.4'}], Loopback: [{family:'IPv4',internal:true,address:'127.0.0.1'}], Disconnected: [{family:'IPv4',internal:false,address:'169.254.1.1'}] };
  const rows = networkRows('0.0.0.0', 3001, interfaces);
  assert.deepEqual(rows.filter(([label]) => label === 'LAN URL'), [['LAN URL','http://192.168.1.10:3001/ (Ethernet)'],['LAN URL','http://10.0.0.4:3001/ (WiFi)']]);
  assert.ok(!rows.some(([,value])=>String(value).includes('http://0.0.0.0')));
  assert.equal(networkRows('127.0.0.1',3001,interfaces).filter(([label])=>label==='LAN URL').length,0);
  assert.equal(probeHost('0.0.0.0'),'127.0.0.1');
  const screen = serviceScreen({action:'start',outcome:'success',host:'0.0.0.0',port:3001,interfaces,environment:'development',durationMs:10}).replace(/\x1b\[[0-9;]*m/g, '');
  assert.match(screen,/LAN URL\s+:  http:\/\/192\.168\.1\.10:3001\/ \(Ethernet\)/);
  assert.match(screen,/LAN URL\s+:  http:\/\/10\.0\.0\.4:3001\/ \(WiFi\)/);
});

test('HOST remains localhost and PORT remains 3001 when unset', async () => {
  const {stdout} = await exec(process.execPath,['--input-type=module','-e',"import {env} from './src/config/env.js'; console.log(JSON.stringify({host:env.host,port:env.port}));"],{env:{...process.env,HOST:'',PORT:''}});
  assert.deepEqual(JSON.parse(stdout),{host:'127.0.0.1',port:3001});
});

test('background service supports wildcard and loopback binding, HTTP APIs, status, restart and stop', {timeout:25000}, async t => {
  const directory = await mkdtemp(path.join(tmpdir(),'bankstream-lan-'));
  const reservation = createServer();
  await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port = reservation.address().port;
  await new Promise(resolve=>reservation.close(resolve));
  const env = {...process.env,HOST:'0.0.0.0',PORT:String(port),NODE_ENV:'development',DATA_SOURCE:'demo',STATE_DIR:directory,LOG_DIR:path.join(directory,'logs'),LOG_LEVEL:'info',NO_COLOR:'1'};
  const service = (action, ...args) => exec(process.execPath,['scripts/service.js',action,...args],{env,timeout:15000});
  try {
    const {stdout} = await service('start');
    assert.equal(stdout.match(/BANKSTREAM_AI_DASHBOARD/g).length,1);
    assert.match(stdout,/Host\s+:  0\.0\.0\.0/);
    const local = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(local)).status,200);
    const addresses = [...new Set(Object.values(networkInterfaces()).flat().filter(entry=>entry.family==='IPv4'&&!entry.internal&&!entry.address.startsWith('169.254.')).map(entry=>entry.address))];
    for (const host of addresses) {
      const base = `http://${host}:${port}`;
      assert.equal((await fetch(base,{signal:AbortSignal.timeout(3000)})).status,200);
      const config = await fetch(new URL('/api/config',base)).then(r=>r.json());
      assert.equal(config.mode,'demo');
      assert.ok(!Object.hasOwn(config,'aiKey'));
      for (let poll=0;poll<2;poll++) {
        const response = await fetch(new URL('/api/dashboard?fresh=1',base));
        assert.equal(response.status,200);
        assert.ok((await response.json()).overview);
      }
      t.diagnostic(`Host-side HTTP and dashboard API checks passed via ${host}; separate-device access unverified.`);
    }
    if (!addresses.length) t.diagnostic('No LAN interface available: LAN HTTP access unverified.');
    assert.match((await service('status')).stdout,/Status\s+:  RUNNING/);
    const cancelled = await service('stop');
    assert.match(cancelled.stdout,/Shutdown cancelled/);
    assert.equal((await fetch(local)).status,200);
    assert.match((await service('restart')).stdout,/SYSTEM ONLINE/);
    assert.equal((await fetch(local)).status,200);
    assert.match((await service('stop','--yes')).stdout,/SHUTDOWN COMPLETED/);
    assert.match((await service('status')).stdout,/Status\s+:  STOPPED/);
    env.HOST='127.0.0.1';
    const loopback = (await service('start')).stdout;
    assert.ok(!loopback.includes('LAN URL'));
    assert.equal((await fetch(local)).status,200);
    for (const host of addresses) await assert.rejects(fetch(`http://${host}:${port}`,{signal:AbortSignal.timeout(1500)}));
  } finally { await service('stop','--yes'); }
});
