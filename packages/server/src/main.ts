/**
 * Taxis game server. Owns the game and talks to the browser over a WebSocket at /ws.
 *
 *   PORT        port to listen on (default 5175; production uses 5173)
 *   HOST        interface to listen on (default 127.0.0.1, this machine only; 0.0.0.0 opens it
 *               to your network — there are no passwords, so only do that on a network you trust)
 *   STATIC_DIR       if set, also serve the built browser client from this folder (production)
 *   SKIN_PLUGINS_DIR if set, load & serve optional cosmetic skin plug-ins at /plugins/*
 *   BUILD_ID         build identifier; a browser from a different build reloads itself
 *   SAVES_DIR        folder for game save files (default ./saves)
 */
import { randomInt } from 'node:crypto';
import { createReadStream, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocketServer } from 'ws';
import { registerExtraSkins } from '@hey-taxi/sim';
import { GameHost } from './host';
import { GameSession } from './session';
import { SaveStore } from './store';

const PORT = Number(process.env.PORT ?? 5175);
const HOST = process.env.HOST || '127.0.0.1';
const STATIC_DIR = process.env.STATIC_DIR ? resolve(process.env.STATIC_DIR) : null;
const SKIN_PLUGINS_DIR = process.env.SKIN_PLUGINS_DIR ? resolve(process.env.SKIN_PLUGINS_DIR) : null;
const BUILD_ID = process.env.BUILD_ID ?? 'dev';
const SAVES_DIR = resolve(process.env.SAVES_DIR ?? 'saves');

if (SKIN_PLUGINS_DIR) {
  try {
    const raw = readFileSync(join(SKIN_PLUGINS_DIR, 'manifest.json'), 'utf8');
    const manifest = JSON.parse(raw) as { skins?: unknown; rivalShare?: unknown };
    const ids = Array.isArray(manifest.skins) ? manifest.skins.filter((s): s is string => typeof s === 'string') : [];
    const share = typeof manifest.rivalShare === 'number' ? manifest.rivalShare : 0.75;
    registerExtraSkins(ids, share);
    console.log(`Loaded ${ids.length} skin plug-in(s) from ${SKIN_PLUGINS_DIR} (rival preference: ${Math.round(share * 100)}%)`);
  } catch (err) {
    console.warn(`Could not read skin plug-in manifest from ${SKIN_PLUGINS_DIR}:`, (err as Error).message);
  }
}

const session = new GameSession({ seed: randomInt(1, 2 ** 31), newSeed: () => randomInt(1, 2 ** 31) });
const store = new SaveStore(SAVES_DIR);
const host = new GameHost(session, BUILD_ID, store);

const http = createServer((req, res) => {
  if (req.url?.startsWith('/plugins/')) {
    servePlugin(req, res);
    return;
  }
  if (STATIC_DIR) serveStatic(STATIC_DIR, req, res);
  else res.writeHead(200, { 'content-type': 'text/plain' }).end('Taxis game server (WebSocket at /ws)');
});
const wss = new WebSocketServer({ server: http, path: '/ws' });
wss.on('connection', (ws) => host.connect(ws));

// Ensure the default starter server exists before accepting players.
await host.init();
http.listen(PORT, HOST, () => {
  const shown = HOST === '127.0.0.1' || HOST === 'localhost' ? 'localhost' : HOST;
  console.log(`Taxis game server on http://${shown}:${PORT}/ (build ${BUILD_ID}, saves in ${SAVES_DIR})`);
  if (shown !== 'localhost') console.log(`Listening on ${HOST}: anyone who can reach this address can play (no passwords).`);
  host.start();
});

let stopping = false;
/** Intentional shutdown: save the game, then exit. */
async function shutdown(): Promise<void> {
  if (stopping) return;
  stopping = true;
  setTimeout(() => process.exit(1), 5000).unref(); // never hang on the way out
  try {
    await host.stop();
    await store.shutdown();
  } catch (err) {
    console.error('Shutdown save failed:', err);
  }
  wss.close();
  http.close(() => process.exit(0));
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  void shutdown();
});

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

function servePlugin(req: IncomingMessage, res: ServerResponse): void {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain' }).end('Bad request');
    return;
  }
  const rel = pathname.slice('/plugins/'.length);
  if (!SKIN_PLUGINS_DIR) {
    if (rel === 'manifest.json') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache' }).end('{"skins":[],"entry":null}');
    } else {
      res.writeHead(404).end();
    }
    return;
  }
  const file = normalize(join(SKIN_PLUGINS_DIR, rel));
  if (file !== SKIN_PLUGINS_DIR && !file.startsWith(SKIN_PLUGINS_DIR + sep)) {
    res.writeHead(403).end();
    return;
  }
  const st = statSync(file, { throwIfNoEntry: false });
  if (!st?.isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-cache',
  });
  createReadStream(file).pipe(res);
}

function serveStatic(base: string, req: IncomingMessage, res: ServerResponse): void {
  let path: string;
  try {
    path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  } catch {
    // Malformed percent-encoding (e.g. "/%E0%A4%A") must not crash the server.
    res.writeHead(400, { 'content-type': 'text/plain' }).end('Bad request');
    return;
  }
  let file = normalize(join(base, path));
  if (file !== base && !file.startsWith(base + sep)) {
    res.writeHead(403).end();
    return;
  }
  let st = statSync(file, { throwIfNoEntry: false });
  if (st?.isDirectory()) {
    file = join(file, 'index.html');
    st = statSync(file, { throwIfNoEntry: false });
  }
  if (!st) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }
  // Hashed build assets never change; index.html must always be re-checked.
  const immutable = file.startsWith(join(base, 'assets'));
  res.writeHead(200, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
}
