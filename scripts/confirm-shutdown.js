import { createInterface } from 'node:readline';

export async function confirmShutdown({ args = process.argv.slice(3), input = process.stdin, output = process.stdout } = {}) {
  if (args.includes('--yes')) return true;
  if (!input.isTTY || !output.isTTY) return false;
  const prompt = createInterface({ input, output });
  return new Promise(resolve => {
    prompt.once('close', () => resolve(false));
    prompt.once('SIGINT', () => prompt.close());
    prompt.question('⚠ Are you sure you want to stop the dashboard? (y/N): ', answer => {
      resolve(answer.trim().toLowerCase() === 'y');
      prompt.close();
    });
  });
}
