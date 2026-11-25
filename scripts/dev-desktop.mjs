import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const concurrentlyBin = resolve('node_modules/concurrently/dist/bin/index.js');
const child = spawn(
  process.execPath,
  [concurrentlyBin, '-k', 'vite', 'electron .'],
  {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
  },
);

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
