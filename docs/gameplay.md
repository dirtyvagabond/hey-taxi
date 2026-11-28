# Gameplay Guide

## Accounts, servers, and saves

- **Accounts & Server Browser:** On startup you sign in with a pilot account (stored in `saves/<env>/accounts.sqlite`) and create or join a persistent world ("server"). Each server lives in its own SQLite database under `saves/<env>/servers/` along with its complete financial ledger.
- **Continuous persistence:** The server saves checkpoints automatically every few seconds while you play, and immediately on pause, menu exit, disconnect, or shutdown.
- **Taxi skins:** Before flying a new taxi you choose a visual skin (**Pixel Cab**, **Jet Retro**, **THE SHORT BUS**, **NEON GHOST**, **CYBER TAXI**, **SHUTTLE**, **BATH CAB**, or **UAP**). Skins are purely cosmetic — all taxis share identical physics and hitboxes. Rival taxis choose skins from the server's seeded RNG.
- **Losing your taxi:** A taxi is destroyed at zero hull points or when it crashes/strands after running dry. The world keeps running, and the lost taxi remains permanently on record with its final history and cause of destruction. Press `Enter` to launch a fresh taxi in Santa Monica (retaining your account balance, with a full tank, full hull, 3 missiles, and 3 flares), `V` for Game review, or `Q` for the lobby.
- **Rivals never respawn:** Destroyed rival taxis stay permanently dead, though new named rivals may enter the world if passenger demand exceeds supply.

## The nine locales

All nine locales exist and simulate simultaneously — even the ones you aren't currently visiting. Rival taxis pick up fares, refuel, fight, and teleport between cities while you fly elsewhere (Santa Monica is a peaceful, rival-free starter beach).

| Locale | Size (tiles) | Fare Multiplier | Environment & Hazards |
|---|---:|---:|---|
| **Santa Monica** | 26 × 14 | ×0.50 | Single-screen beginner beach (3 platforms, no rivals, low fares; local-only until your first drop-off). |
| **First Shift** | 64 × 18 | ×1.00 | Easy streets, low pads, short hops. |
| **Midtown** | 64 × 36 | ×1.33 | Stacked upper and lower city linked by gaps in a central floor. |
| **Skyline** | 128 × 36 | ×2.00 | Large vertical city with shafts, ledges, awnings, and long hauls. |
| **Frostbite Pass** | 64 × 36 | ×1.60 | Periodic winter wind gusts across exposed ridges; shelter in valleys. |
| **Singularity Station** | 80 × 36 | ×2.50 | Central black hole gravity well — slingshot around it and avoid the horizon. |
| **Polarity Yard** | 64 × 36 | ×1.75 | Normal, Low-G, and Inverted-G magnetic bays (use down thrust to settle in inverted bays). |
| **Gridlock Vault** | 96 × 36 | ×2.60 | Timed laser gates and sliding Electroid barriers with shortcuts and detours. |
| **Overdrive Canyon** | 96 × 36 | ×3.00 | Turbo-charged thrusters, heavy gravity, higher burn, and falling meteors. |

### Teleports

Violet teleport pads connect all nine locales for free. Land on a teleport and choose any destination (`1`–`8` or click). The panel shows each locale's fare multiplier, size, waiting passengers, and active taxis. Taxis parked on a teleport cannot be targeted by missiles.

## Flight, landing gear, and fuel

- **Manual gear & side jets:** Left/right thrusters only fire when the landing gear is **fully retracted**. From the moment the gear begins extending until it is completely up again, lateral thrust is disabled (the HUD shows `✕◀▶`), though you keep existing horizontal momentum. Line up over your pad with gear up, extend the gear, and descend straight down. Rivals obey the same rule.
- **Facing:** Pressing left or right turns your taxi in that direction immediately (whether landed or airborne); drifting backward does not flip your facing.
- **Safe landings:** Extend gear, watch the `VY`/`VX` readout (green is safe), and place at least half your skids on a flat surface.
- **Fuel & stores:** Fuel pads are convenience stores (safe zones from missile locks). Nothing is automatic — buy what you can afford:
  - `1` Missile ($12)
  - `2` Flare burst ($6)
  - `3` Hull repair ($20 per point)
  - `4` One gallon of gas ($2; full tank is 10 gallons)
  - `5` Fill tank (or as much as you can afford)
- **Running dry & Rescue Service:** If your tank empties in mid-air, the engines cut out and you fall under gravity. If you touch down safely away from a store, press `R` to summon the **Rescue Service** ambulance to refuel or repair at 2× store prices.

## Passengers, fares, and tips

Each resident has a permanent name, appearance, voice and home locale. Delivered passengers rest in their arrival locale and can hail again. Death is permanent.

Passengers wave from glowing pads. Land beside them (not on top of them) and they walk over and board, naming their destination pad.

- **Fares** scale with trip distance and the locale's fare multiplier.
- **Tips** are a percentage of the fare (baseline **20%** for a smooth, on-time ride, up to **25%** for arriving early).
  - Late arrivals lose 0.5 percentage points per second past the allowance.
  - Service penalties deduct percentage points: ok landing (−2), rough landing (−5), hard landing (−8), bump (−3), hull damage (−5), or taking off while the passenger is walking to board (−3).

Some passengers ask for another locale. Fly to a violet teleport and choose the requested city. The passenger announces their pad on arrival. A detour costs the tip. In an unwanted city, the passenger requests a temporary drop-off. Return to their intended locale while they are still aboard and they ask for the original pad again. If they get out at the temporary stop, they hail for the rest of their journey.

Press **E** to eject your passenger. A passenger close to safe ground hops out. In the air they open a parachute and steer toward their target while wind, gravity and hazards affect them. Ejection always pays zero. A survivor who lands short hails again and refuses the ejecting driver for the rest of this journey, even in a replacement cab. A different driver earns a fare for the remaining route and can earn a fresh tip. Rivals can eject riders in a flight emergency.

## Combat, damage, and co-pilots

- **Missiles & flares:** Press `F` to fire a heat-seeking missile at the nearest locked taxi (shown with red brackets). Missiles have ~3.5 seconds of powered flight before motor burnout, after which they drop and detonate on impact. Press `C` to deploy countermeasure flares.
- **Hull & progressive damage:** Every taxi has 6 hull points. A missile hit costs 2 hull; collisions (hard landings, walls, gear-up landings, or ramming) cost 1 hull. Visual cues escalate as hull drops: smoke wisps and pips at 4 hull, steady smoke and scorch marks at 3, red tint and sparks at 2, and flames, sputtering engine, red glow, and warning alarm at 1.
- **AI co-pilot:** Every taxi (player and rival) has a co-pilot with a fixed countermeasure proficiency (65–95) rolled when the taxi is created. When a missile closes in, the co-pilot gets one chance per missile to automatically pop your flares (if available and off cooldown). Press `H` while landed to inspect your co-pilot.
- **Kill attribution:** Taxis destroyed by missiles or ramming record the attacker on the destroyed card, in live announcements, and in Game review.

## Rival taxis & world overview

Named rival taxis operate under their own autopilot — picking up passengers, shopping for fuel/repairs/ammo, firing missiles, and teleporting between locales. When passengers wait unclaimed in a locale, the world's population manager either dispatches an idle, healthy rival from a locale with spare capacity or spawns a new rival (bounded by per-locale and world caps).

Press `Tab` to open the **World Overview**, inspect activity across all nine locales, or spectate any locale or taxi (`[` / `]` to cycle, `Esc` to return to your cab).

## Game review

Accessible from the lobby or by pressing `V` after losing a taxi, **Game review** reads directly from the server's SQLite ledger:

- **Overview:** Fare revenue, tips, spending by category, net profit, starting funds vs. earned cash, and causes of every lost taxi.
- **Taxis:** Every living and destroyed taxi with co-pilot proficiency, fares, income, expenses, balance, and full lifecycle history.
- **Transactions:** Every recorded ledger entry, filterable by taxi, locale, and category, with text search.
