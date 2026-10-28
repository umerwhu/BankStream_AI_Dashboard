import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { confirmShutdown } from '../scripts/confirm-shutdown.js';

test('interactive shutdown confirms only y/Y and defaults to cancellation', async () => {
  for (const [answer, expected] of [['y',true],['Y',true],['n',false],['N',false],['',false],['yes',false]]) {
    const input = new PassThrough(), output = new PassThrough();
    input.isTTY = output.isTTY = true;
    let text = ''; output.on('data', chunk => { text += chunk; });
    const result = confirmShutdown({args:[],input,output});
    input.write(`${answer}\n`);
    assert.equal(await result,expected);
    assert.ok(text.includes('Are you sure you want to stop the dashboard? (y/N):'));
    input.destroy(); output.destroy();
  }
});

test('non-interactive shutdown cancels immediately unless --yes is explicit', async () => {
  const input = new PassThrough(), output = new PassThrough();
  assert.equal(await confirmShutdown({args:[],input,output}),false);
  assert.equal(await confirmShutdown({args:['--yes'],input,output}),true);
  input.destroy(); output.destroy();
});

test('closed interactive input cancels safely', async () => {
  const input = new PassThrough(), output = new PassThrough();
  input.isTTY = output.isTTY = true;
  output.resume();
  const result = confirmShutdown({args:[],input,output});
  input.end();
  assert.equal(await result,false);
  output.destroy();
});
