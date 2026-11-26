// "Production": runs the released game server (release/current/server.mjs) on port 5173,
// serving the released browser client, with saves in saves/prod. Code changes never reach it
// until `npm run release`; when a new release (or a rollback) lands, the server is restarted
// on it (it saves on shutdown) and open browser tabs reload themselves.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const current = join(process.env.RELEASE_DIR ?? join(root, 'release'), 'current');
const PORT = process.env.PORT ?? '5173';

const buildOf = () => {
  try {
    return JSON.parse(readFileSync(join(current, 'release.json'), 'utf8')).buildId ?? 'unknown';
  } catch {
    return null;
  }
};

let child = null;
let running = null;
let stopping = false;

function start() {
  const build = buildOf();
  if (!build) {
    console.log('No release yet: run `npm run release`. Waiting…');
    return;
  }
  running = build;
  // Run from a copy of the path that is current right now; a later swap renames the folder.
  child = spawn(process.execPath, [join(current, 'server.mjs')], {
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT,
      BUILD_ID: build,
      STATIC_DIR: join(current, 'public'),
      SAVES_DIR: process.env.SAVES_DIR ?? join(root, 'saves', 'prod'),
    },
  });
  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) process.exit(0);
    if (running === build && signal !== 'SIGTERM') {
      console.log(`Game server exited (${code ?? signal}); restarting in 1s…`);
      setTimeout(start, 1000);
    }
  });
}

/** Restart when release/current holds a different build. */
setInterval(() => {
  const build = buildOf();
  if (!build || build === running) return;
  console.log(`New release ${build}: restarting the game server…`);
  running = build;
  if (child) {
    child.once('exit', () => start());
    child.kill('SIGTERM');
  } else {
    start();
  }
}, 1000);

const stop = () => {
  stopping = true;
  if (child) child.kill('SIGTERM');
  else process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
start();
