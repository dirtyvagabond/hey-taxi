# Architecture

Hey, Taxi! is a TypeScript npm-workspaces monorepo split into three packages: a pure simulation, an authoritative Node server, and a PixiJS browser client.

## Package overview

```text
@hey-taxi/sim     (packages/sim)     Pure deterministic single-locale simulation
@hey-taxi/server  (packages/server)  Authoritative multi-locale server, SQLite saves, WS host
@hey-taxi/client  (packages/client)  PixiJS renderer, audio, UI overlays, input
```

### `@hey-taxi/sim` (`packages/sim`)

Zero DOM or filesystem dependencies. Owns all game rules for a single locale:

- **Simulation contract:** `step(state, inputs) -> events` advances one fixed tick at 60 Hz using explicit simulation time and seeded PRNG (`rng.ts`).
- **Subsystems:** physics & collisions (`sim.ts`), environmental hazards such as wind, gravity wells, polarity zones, laser gates, and meteors (`env.ts`), passengers & fares (`passengers.ts`), heat-seeking missiles & flares (`missiles.ts`), AI co-pilots (`copilot.ts`), flying convenience service (`service.ts`), rival autopilot (`ai.ts`), taxi names/personalities (`personality.ts`), and double-entry style accounting events (`accounts.ts`).
- **Level content:** `content.ts` imports the eight world maps (`WORLD`, `WORLD_LEVELS`) and computes a stable FNV-1a content hash per map so saves can verify map compatibility. The retired campaign maps and free-flight sandbox maps are test fixtures only (`test/fixtures/`).
- **Wire protocol:** `protocol.ts` (imported as `@hey-taxi/sim/protocol`) defines every WebSocket message and payload type shared by the server and client, so the client depends only on `@hey-taxi/sim`.
- **Tuning:** `config.ts` (`DEFAULT_CONFIG`) holds all tunable physics, economy, combat, and population parameters.

### `@hey-taxi/server` (`packages/server`)

Authoritative Node.js game server:

- **Multi-locale world (`world.ts`):** Runs one `@hey-taxi/sim` instance per locale in lockstep at 60 Hz, handles cross-locale taxi teleportation without resetting either locale, and tracks player accounts and destroyed taxi records.
- **Population manager (`population.ts`):** Periodically evaluates waiting passenger demand across all locales and either dispatches idle rivals via teleport or spawns new named rivals within configured caps.
- **Session & WebSocket host (`session.ts`, `host.ts`, `codec.ts`):** Manages lobby/account selection, server creation/loading, live gameplay, world overview, spectating, and JSON WebSocket messaging at `/ws`. Strips server-only AI memory (`WireTaxi`) before streaming frames to clients.
- **Persistence (`store.ts`, `store-worker.mjs`, `saver.ts`, `ledger.ts`, `review.ts`):** All SQLite I/O runs off the simulation thread in a dedicated `worker_threads` worker using Node's built-in `node:sqlite` (`DatabaseSync`):
  - `saves/<env>/accounts.sqlite` — global pilot accounts (`account_id`, name, skin/color preferences).
  - `saves/<env>/servers/<serverId>.sqlite` — per-server database containing `meta`, atomic `checkpoint` snapshots, and an append-only `ledger` table committed in the same transaction.

### `@hey-taxi/client` (`packages/client`)

Browser client built with Vite and PixiJS 8:

- **Rendering (`src/render/`):** Tile world, environmental effects, passengers, missiles, particles, HUD, landing guides, and modular taxi skins (`skins/pixelCab.ts`, `skins/jetRetro.ts`, `skins/original.ts`, etc.). Dev builds expose a skin preview matrix at `http://localhost:5174/?skins`.
- **Audio & speech (`src/audio.ts`, `src/voice.ts`):** Pure Web Audio API synthesizer with zero binary asset files — engine hiss/rumble, thrusters, explosions, alarms, cash/UI cues, and procedural C64-style formant passenger speech.
- **UI overlays:** HTML overlays for the account/server lobby (`lobby.ts`), World Overview (`overview.ts`), Game review (`review.ts`), settings (`ui/settings.ts`), and live `lil-gui` tuning panel (`debug.ts`).

## Level generation & validation

The eight world maps in `levels/world/` are generated and statically validated by `levels/world/generate.py`:

```bash
python3 levels/world/generate.py levels/world
```

The generator verifies that every landing pad, store, and teleport is reachable with sufficient vertical clearance to hover and descend straight down under the manual landing-gear rule. `packages/sim/test/world-levels.test.ts` additionally runs the rival autopilot across every locale to verify navigability and teleport routing.

## Live tuning & release flow

- **Live tuning:** Press `` ` `` in the browser to open the `lil-gui` tuning panel. Edits apply live on the server and are persisted with the server save. Use **Copy tuning as JSON** to transfer tuned values back into `packages/sim/src/config.ts`.
- **Release & rollback (`scripts/release.mjs`, `scripts/prod.mjs`):** `npm run release` runs typecheck, tests, and Vite builds for both client and server into `release/next`, then atomically swaps `release/current` and `release/previous`. `scripts/prod.mjs` watches `release/current/release.json` and cleanly restarts the server when a new build lands.
