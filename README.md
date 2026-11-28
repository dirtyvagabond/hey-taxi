# Hey, Taxi!

A browser-based multiplayer thrust-and-gravity game of picking up passengers and delivering them safe and sound — an homage to the 1984 Commodore 64 classic Space Taxi, with original art, persistent interconnected cities, combat, and AI rivals.

Fly passengers between pads, manage fuel and manual landing gear, dodge and fire heat-seeking missiles, and teleport between cities to make higher fares.

## Prerequisites

- **Node.js 22.13+** (uses the built-in `node:sqlite` module for persistent saves)
- **npm** (ships with Node.js)
- **Python 3** *(optional)* — only needed if you edit and regenerate the world maps (`levels/world/generate.py`)

## Quick start

```bash
npm install
npm run dev
```

Open **http://localhost:5174** in your browser. `npm run dev` starts both the authoritative Node game server (port `5175`, saves in `saves/dev`) and the Vite dev client (port `5174`, proxies `/ws` to the server).

### Local production build

To run a bundled production build on port `5173` (with separate saves in `saves/prod`):

```bash
npm run release   # typecheck, test, build, and stage to release/current
npm run prod      # run the released server + client at http://localhost:5173
```

You can roll back to the previous staged build at any time with `npm run rollback`.

### Playing on your local network

By default the game server only listens on `127.0.0.1`, so it is reachable from your own machine only. To let other devices on your network join, set `HOST`:

```bash
HOST=0.0.0.0 npm run prod   # or: HOST=0.0.0.0 npm run dev
```

Then open `http://<your-computer's-IP>:5173` (or `:5174` in dev) from the other device.

> **Warning:** there are no passwords — anyone who can reach that address can pick any pilot account and create or join worlds. Only do this on a network you trust, and never expose the port to the internet.

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Interface the game server (and, in dev, Vite) listens on |
| `PORT` | `5175` dev / `5173` prod | Game server port |
| `SAVES_DIR` | `saves/dev` / `saves/prod` | Where SQLite saves are written |

### Other commands

```bash
npm test          # run simulation and server unit tests (Vitest)
npm run typecheck # typecheck @hey-taxi/sim, @hey-taxi/server, and @hey-taxi/client
npm run build     # build the browser client bundle
```

## Controls

| Action | Keys |
|---|---|
| Thrust up / down / left / right | `↑` `↓` `←` `→` or `W` `S` `A` `D` |
| Toggle landing gear *(side jets only work with gear fully retracted)* | `Space` |
| Fire heat-seeking missile | `F` |
| Pop countermeasure flares | `C` |
| Buy missile / flare burst / hull repair *(at a store or Rescue Service)* | `1` / `2` / `3` |
| Buy 1 gallon of gas / fill tank *(at a store or Rescue Service)* | `4` / `5` |
| Summon Rescue Service ambulance *(while parked away from a store; 2× prices)* | `R` |
| Teleport destination *(while parked on a violet teleport pad)* | `1`–`7` or click |
| World overview / spectate locales & taxis | `Tab` (`[` / `]` to cycle) |
| Co-pilot status panel *(while landed)* | `H` |
| Pause / return from spectate | `P` / `Esc` |
| Main menu *(while paused or destroyed)* | `Q` |
| Game review *(when your taxi is destroyed)* | `V` |
| Mute audio | `M` |
| Tuning panel *(live simulation parameters)* | `` ` `` (backquote) |
| Rival population diagnostics *(dev builds)* | `I` |

## Repository layout

```text
packages/
  sim/       Pure deterministic simulation for one locale (no DOM/IO): physics,
             passengers, missiles, co-pilots, rival AI, accounting, level content,
             and the client/server wire protocol (`@hey-taxi/sim/protocol`).
             Test-only maps live in `sim/test/fixtures/`.
  server/    Authoritative Node game server: multi-locale world simulation,
             rival population manager, accounts & persistent servers, SQLite
             worker-thread saves, ledger, and WebSocket host.
  client/    PixiJS browser client: renderer, taxi skins, particles, camera,
             Web Audio synth, lobby/server browser, world overview, Game review
             UI, and lil-gui tuning panel.
levels/
  world/     The nine interconnected world locales + Python generator/validator.
scripts/     Dev runner, release/rollback pipeline, and local production supervisor.
docs/        Detailed gameplay guide and architecture notes.
```

## Documentation

- **[Gameplay Guide](docs/gameplay.md)** — Locales, flight & landing gear rules, fares and tips, combat, co-pilots, stores, teleports, rival population, accounts/servers, and Game review.
- **[Architecture](docs/architecture.md)** — Monorepo design, simulation contract, SQLite persistence, WebSocket protocol, level generation, and live tuning.

## Credits & Third-Party Notices

- **PetMe64 font** (`packages/client/public/fonts/PetMe64.ttf`) by **Kreative Korporation / Kreative Software**, used verbatim under the [Kreative Software Relay Fonts Free Use License v1.2f](packages/client/public/fonts/FreeLicense.txt).

## License

[MIT](LICENSE)
