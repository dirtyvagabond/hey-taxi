// Development: the game server (auto-restarts on code changes, port 5175, saves in saves/dev)
// and the Vite dev server for the browser (http://localhost:5174, proxies /ws to the game server).
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const children = [
  spawn('npm', ['run', 'dev', '-w', '@hey-taxi/server'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, PORT: '5175', SAVES_DIR: join(root, 'saves', 'dev') },
  }),
  // With HOST set (e.g. HOST=0.0.0.0), the Vite dev server is opened to the network too.
  spawn('npx', ['vite', ...(process.env.HOST ? ['--host', process.env.HOST] : [])], {
    cwd: join(root, 'packages', 'client'),
    stdio: 'inherit',
  }),
];
const stop = () => {
  for (const c of children) c.kill('SIGTERM');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const c of children) c.on('exit', (code) => {
  stop();
  process.exitCode = code ?? 0;
});
