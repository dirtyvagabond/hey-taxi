// Roll out the current code to "production" (http://localhost:5173/, run by scripts/prod.mjs,
// which restarts the game server on the new release; open browser tabs reload themselves).
//
//   npm run release            typecheck, test, build, then swap the build in
//   npm run release -- --rollback   put the previous release back
//
// Releases live in release/current (served) and release/previous (one step of rollback).
// The swap is two directory renames, so the served game never sees a half-written build.
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// RELEASE_DIR lets a trial release go somewhere other than the real production folder.
const releaseRoot = process.env.RELEASE_DIR ?? join(root, 'release');
const dir = (name) => join(releaseRoot, name);
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

if (process.argv.includes('--rollback')) {
  if (!existsSync(dir('previous'))) throw new Error('No previous release to roll back to.');
  rmSync(dir('rolled-back'), { recursive: true, force: true });
  if (existsSync(dir('current'))) renameSync(dir('current'), dir('rolled-back'));
  renameSync(dir('previous'), dir('current'));
  console.log('Rolled back: release/current is the previous release again (the undone one is in release/rolled-back).');
  process.exit(0);
}

run('npm run typecheck');
if (!process.argv.includes('--no-tests')) run('npm test');
rmSync(dir('next'), { recursive: true, force: true });
const buildId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
// Browser client (served from public/) and the bundled game server (server.mjs).
run(`VITE_BUILD_ID=${buildId} npx vite build packages/client --outDir ${JSON.stringify(join(dir('next'), 'public'))} --emptyOutDir`);
run(`npx vite build packages/server --outDir ${JSON.stringify(dir('next'))}`);
// The save worker runs as its own thread from a file next to server.mjs.
copyFileSync(join(root, 'packages', 'server', 'src', 'store-worker.mjs'), join(dir('next'), 'store-worker.mjs'));
writeFileSync(join(dir('next'), 'release.json'), JSON.stringify({ buildId, releasedAt: new Date().toISOString() }, null, 2));

rmSync(dir('previous'), { recursive: true, force: true });
if (existsSync(dir('current'))) renameSync(dir('current'), dir('previous'));
renameSync(dir('next'), dir('current'));
console.log(`\nReleased build ${buildId} to production: http://localhost:5173/`);
