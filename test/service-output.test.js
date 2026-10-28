import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { formatLine, serviceScreen } from '../scripts/service-output.js';

test('service screens share aligned labels and one banner, preserving accurate outcomes', () => {
  assert.equal(formatLine('Status', 'RUNNING'), 'Status         :  RUNNING');
  for (const action of ['start', 'stop']) {
    for (const outcome of ['success', 'already', 'failure']) {
      const text = serviceScreen({ action, outcome, pid: 123, environment: 'development', port: 3001, logsDir: './logs/', durationMs: 123,
        aiProvider: 'deepseek', logLevel: 'INFO', error: outcome === 'failure' ? new Error('EACCES: operation denied') : undefined });
      const plain = text.replace(/\x1b\[[0-9;]*m/g, '');
      assert.equal(plain.match(/BANKSTREAM_AI_DASHBOARD/g).length, 1);
      assert.match(plain, /Host\s+:  127\.0\.0\.1/);
      assert.match(plain, /Local URL\s+:  http:\/\/127\.0\.0\.1:3001\//);
      assert.ok(!plain.includes('LAN URL'));
      if (action === 'start') {
        assert.match(plain, /Stop\s+:  npm stop/);
        assert.ok(!plain.includes('npm run service:stop'));
      }
      for (const line of plain.split('\n').filter(line => /^[A-Za-z][A-Za-z ]+\s+:  /.test(line))) {
        assert.equal(line.indexOf(':'), 15);
        assert.notEqual(line[18], ' ');
      }
      if (outcome === 'already') assert.match(plain, /ALREADY/);
      if (outcome === 'failure') assert.match(plain, /EACCES: operation denied/);
      if (action === 'stop' && outcome === 'success') assert.match(plain, /graceful completion unverified/);
    }
  }
});

test('ANSI colors preserve columns and both banners share the cyan shield', () => {
  const script = `import {serviceScreen} from './scripts/service-output.js'; for(const action of ['start','stop']) console.log(serviceScreen({action,outcome:'success',environment:'development',port:3001,logsDir:'./logs/',durationMs:1,aiProvider:'deepseek',logLevel:'INFO'}));`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { encoding: 'utf8', env: {...process.env, FORCE_COLOR:'1', NO_COLOR:''} });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\x1b\[96m/);
  assert.match(result.stdout, /\x1b\[92m\[✓\]/);
  assert.match(result.stdout, /\x1b\[91m\[■\]/);
  const plain = result.stdout.replace(/\x1b\[[0-9;]*m/g, '');
  assert.equal(plain.match(/BANKSTREAM_AI_DASHBOARD/g).length, 2);
  for (const line of plain.split('\n').filter(line => /^[A-Za-z][A-Za-z ]+\s+:  /.test(line))) assert.equal(line.indexOf(':'), 15);
});

test('status reuses one banner and aligned rows for running and stopped services', () => {
  const interfaces = { 'Wi-Fi': [{family:'IPv4',internal:false,address:'192.168.1.10'}], 'Long virtual adapter name': [{family:'IPv4',internal:false,address:'172.16.1.2'}] };
  for (const running of [true, false]) {
    const text = serviceScreen({action:'status',outcome:running?'success':'already',pid:running?123:null,host:'0.0.0.0',port:3001,environment:'development',tapdata:true,aiProvider:'deepseek',logLevel:'INFO',logsDir:'./logs/',interfaces}).replace(/\x1b\[[0-9;]*m/g,'');
    assert.equal(text.match(/BANKSTREAM_AI_DASHBOARD/g).length,1);
    assert.match(text,/◆ SYSTEM STATUS ◆/);
    assert.ok(text.includes(running?'SYSTEM ONLINE — SERVICE RUNNING':'SYSTEM OFFLINE — SERVICE STOPPED'));
    assert.match(text,/NETWORK ACCESS/);
    assert.match(text,/LAN \(Wi-Fi\)\s+:  http:\/\/192\.168\.1\.10:3001\//);
    assert.match(text,/LAN 2\s+:  http:\/\/172\.16\.1\.2:3001\/ \(Long virtual adapter name\)/);
    assert.match(text,/TapData API\s+:  Configured/);
    assert.ok(!text.includes('Connected'));
    assert.match(text,/Stop\s+:  npm stop/);
    assert.ok(!text.includes('Shutdown Time'));
    for (const line of text.split('\n').filter(line=>/^.{15}:  /.test(line))) {
      assert.equal(line.indexOf(':'),15);
      assert.notEqual(line[18],' ');
    }
  }
  const script = `import {serviceScreen} from './scripts/service-output.js'; for(const outcome of ['success','already']) console.log(serviceScreen({action:'status',outcome,host:'127.0.0.1',port:3001,environment:'development',aiProvider:'deepseek',logLevel:'INFO',logsDir:'./logs/'}));`;
  const result = spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:{...process.env,FORCE_COLOR:'1',NO_COLOR:''}});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/\x1b\[92m\[✓\] SYSTEM ONLINE/);
  assert.match(result.stdout,/\x1b\[91m\[■\] SYSTEM OFFLINE/);
});
