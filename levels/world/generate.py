"""
Generates the game's nine locales and checks they're fair.

    python3 levels/world/generate.py levels/world [-v]

Sizes are reported by total area relative to First Shift (64x18 tiles).
Santa Monica (26x14) is the single-screen beginner beach sanctuary with 3 passenger pads,
no rivals, low fares, and local-only rides until the player's first drop-off.

Every pad (passenger pads 1-9, stores F, teleports T) must be reachable from the spawn by a
2x2-tile box (the taxi is 48x34 in 40u tiles): no passage is narrower or shorter than two
tiles, and there is a 2x2 space right above each pad, so the taxi can hover lined up, lower
its gear (no side jets from then on) and come straight down. `-v` prints the maps.
"""
import json, sys
from collections import deque
OUT = sys.argv[1]

class L:
    def __init__(s, cols, rows):
        s.C, s.R = cols, rows
        s.g = [['.'] * cols for _ in range(rows)]
        s.fill(0, 0, 0, cols - 1); s.fill(rows - 1, rows - 1, 0, cols - 1)
        s.fill(0, rows - 1, 0, 0); s.fill(0, rows - 1, cols - 1, cols - 1)
    def fill(s, r0, r1, c0, c1, ch='#'):
        for r in range(r0, r1 + 1):
            for c in range(c0, c1 + 1): s.g[r][c] = ch
    def clear(s, r0, r1, c0, c1): s.fill(r0, r1, c0, c1, '.')
    def pad(s, label, row, c0, c1, base=1):
        """Pad surface tiles on `row`, with `base` rows of solid support below."""
        s.fill(row, row, c0, c1, label)
        if base: s.fill(row + 1, min(row + base, s.R - 1), c0, c1)
    def rows(s): return [''.join(r) for r in s.g]

def check(lv, min_pads=5):
    """Problems found (empty = OK)."""
    g = lv.g; C, R = lv.C, lv.R
    free = lambda c, r: (0 <= c < C - 1 and 0 <= r < R - 1 and
                         all(g[r + dr][c + dc] in '.S' for dr in (0, 1) for dc in (0, 1)))
    sr, sc = next((r, c) for r in range(R) for c in range(C) if g[r][c] == 'S')
    start = next((c, r) for r in (sr - 1, sr) for c in (sc - 1, sc) if free(c, r))
    seen = {start}; q = deque([start])
    while q:
        c, r = q.popleft()
        for dc, dr in ((1,0),(-1,0),(0,1),(0,-1)):
            n = (c + dc, r + dr)
            if n not in seen and free(*n): seen.add(n); q.append(n)
    problems, labels, kinds = [], set(), {'pad': 0, 'F': 0, 'T': 0}
    for r in range(R):
        c = 0
        while c < C:
            ch = g[r][c]
            if ch.isdigit() or ch in 'FT':
                c0 = c
                while c < C and g[r][c] == ch: c += 1
                c1 = c - 1
                if ch.isdigit():
                    if ch in labels: problems.append(f'pad {ch} appears twice')
                    labels.add(ch); kinds['pad'] += 1
                else: kinds[ch] += 1
                if c1 - c0 + 1 < 3: problems.append(f'pad {ch} @col {c0} narrower than 3 tiles')
                if ch == 'T' and c1 - c0 + 1 < 6: problems.append(f'teleport @col {c0} narrower than 6 tiles (two taxis must fit)')
                if not any((x, r - 2) in seen for x in range(c0, c1)): problems.append(f'pad {ch} @row {r} col {c0} unreachable')
            else:
                c += 1
    if kinds['pad'] < min_pads: problems.append(f'fewer than {min_pads} passenger pads')
    if not kinds['F']: problems.append('no store')
    if not kinds['T']: problems.append('no teleport')
    return problems

locales = []

# 0 — Santa Monica (26x14): single-screen beginner beach sanctuary (homage to The Beach).
# Three open-air platforms all visible in one Comfort-zoom frame, low fares, no NPCs, and
# local-only passengers until the player completes their first drop-off.
sm = L(26, 14)
sm.pad('1', 11, 1, 4, base=1); sm.g[10][2] = 'S'           # Beach Lounge Deck (sand & loungers)
sm.pad('2', 7, 6, 9, base=0)                               # Giant Beach Umbrella canopy
sm.pad('F', 11, 10, 12, base=1)                            # Store / Fuel
sm.pad('T', 11, 14, 19, base=1)                            # Pier Teleport
sm.pad('3', 9, 21, 24, base=0); sm.fill(10, 12, 22, 23)    # Santa Monica Lifeguard Tower
locales.append(('0-santa-monica', 'Santa Monica', 0.5, (7.0, 2), 0,
  'Sunny beach training: three easy platforms, no rivals, low fares. Teleport when ready for the city!', sm, {
    'theme': 'beach',
    'noRivals': True,
    'firstFareLocalOnly': True,
  }))

# 1 — First Shift (64x18, 1x): the easy one. Wide, low pads with headroom; short hops.
a = L(64, 18)
a.pad('1', 14, 2, 7, base=2); a.g[13][4] = 'S'
a.pad('2', 12, 13, 18, base=0); a.fill(13, 16, 14, 17)
a.pad('T', 14, 19, 24, base=2)          # teleport between pads 2 and 3
a.pad('3', 14, 27, 32, base=2)
a.pad('F', 15, 9, 11)
a.pad('4', 14, 36, 41, base=2)
a.pad('5', 12, 47, 52, base=0); a.fill(13, 16, 48, 51)
a.pad('F', 15, 57, 60)
locales.append(('1-first-shift', 'First Shift', 1.0, (6.5, 5), 2,
  'Easy streets and short hops. Teleport (violet pad) to the bigger cities for bigger fares.', a, {}))

# 2 — Midtown (64x36, 2x): an upper city and a lower district, joined through two gaps in a
# floor across the middle. Towers, a shelf, pads at varied heights. Moderately harder.
b = L(64, 36)
b.fill(18, 18, 1, 62); b.clear(18, 18, 9, 14); b.clear(18, 18, 35, 40); b.clear(18, 18, 45, 49)   # the floor, three gaps
# upper city
b.pad('1', 16, 2, 7, base=1); b.g[15][4] = 'S'
b.fill(9, 9, 1, 11)                                    # shelf over the start
b.fill(8, 17, 20, 23); b.pad('2', 7, 19, 24, base=0)    # tower, rooftop pad
b.pad('F', 16, 26, 29, base=1)
b.pad('3', 12, 30, 35, base=1)                          # floating platform
b.pad('4', 5, 45, 50, base=1)                           # high pad
b.fill(10, 17, 52, 53)                                  # tower wall
b.pad('T', 16, 55, 60, base=1)                          # teleport
# lower district
b.pad('5', 33, 2, 7, base=1)
b.pad('6', 26, 15, 20, base=1)
b.fill(19, 30, 27, 28)                                  # wall; pass under it (rows 31-34)
b.pad('7', 33, 32, 37, base=1)
b.fill(24, 24, 42, 56); b.pad('8', 30, 45, 50, base=1)  # shelf with a pad tucked under it
b.pad('9', 21, 57, 61, base=1)
b.pad('F', 33, 56, 60, base=1)
b.pad('F', 33, 10, 13, base=1)                          # second store, lower west
locales.append(('2-midtown', 'Midtown', 1.33, (5.5, 7), 3,
  'Two cities stacked: fly through the gaps in the middle floor. Fares pay a third more.', b, {}))

# 3 — Skyline (128x36, 4x): a big, vertical city. Elevator shafts with offset gaps, a tall
# central tower, awnings in the east. Substantially larger and harder; fares pay double.
c = L(128, 36)
# west: shafts (walls with gaps at alternating heights)
c.pad('1', 33, 2, 7, base=1); c.g[32][4] = 'S'
c.fill(4, 34, 12, 12); c.clear(28, 31, 12, 12)          # shaft wall, gap low (rows 28-31)
c.fill(1, 30, 22, 22); c.clear(6, 8, 22, 22)            # shaft wall, gap high (rows 6-8)
c.pad('2', 20, 2, 6, base=1)
c.pad('F', 33, 14, 18, base=1)
c.pad('3', 12, 14, 19, base=1)
c.pad('4', 25, 15, 20, base=1)
# central tower district
c.fill(14, 34, 40, 47); c.pad('5', 13, 39, 48, base=0)  # tall tower, rooftop pad
c.fill(1, 6, 52, 53)                                     # hanging wall
c.pad('T', 33, 26, 31, base=1)                           # teleport, by the west shafts
c.pad('6', 22, 54, 59, base=1)                           # floating platform
c.fill(28, 28, 50, 70)                                   # long shelf over the low road
c.pad('F', 33, 60, 64, base=1)
c.fill(8, 22, 72, 73)                                    # wall: pass above (1-7) or below (23-34)
# east: awnings and a high-rise
c.fill(10, 10, 78, 96); c.pad('7', 16, 82, 87, base=2)   # awning, pad below it
c.fill(19, 34, 100, 103); c.pad('8', 18, 99, 104, base=0)   # high-rise, rooftop pad
c.fill(26, 26, 106, 122); c.pad('9', 32, 110, 115, base=2)  # awning over the far corner pad
c.pad('F', 15, 116, 120, base=1)
c.pad('T', 33, 85, 90, base=1)                           # second teleport, east
locales.append(('3-skyline', 'Skyline', 2.0, (4.5, 8), 4,
  'A big vertical city: shafts, ledges and long hauls. Every fare pays double.', c, {}))

# 4 — Frostbite Pass (64x36, 2x): winter alpine skyport with alternating wind gusts & sheltered valleys.
d = L(64, 36)
# Sheltered west valley + windbreak ridge
d.pad('1', 33, 2, 7, base=1); d.g[32][4] = 'S'
d.pad('F', 33, 10, 14, base=1)
d.fill(18, 34, 17, 19)                                    # west windbreak wall
d.pad('2', 17, 15, 20, base=0)                            # exposed ridge pad atop windbreak
d.fill(10, 10, 1, 13); d.pad('3', 16, 2, 7, base=1)       # sheltered alpine overhang
# Central glacier valley
d.pad('T', 33, 24, 30, base=1)                            # sheltered valley teleport
d.pad('4', 24, 24, 29, base=1)                            # mid-air ice shelf
d.pad('5', 8, 28, 33, base=1)                             # high exposed summit pad
d.fill(20, 34, 37, 39)                                    # central windbreak pillar
d.pad('6', 19, 36, 41, base=0)                            # wind-swept crag pad
# East gorge & exposed peak
d.fill(13, 13, 45, 62); d.pad('7', 19, 48, 53, base=1)    # sheltered ice cave pad
d.pad('8', 33, 44, 49, base=1)                            # deep east canyon floor
d.pad('F', 9, 55, 59, base=1)                             # exposed high-altitude store
d.pad('9', 33, 55, 60, base=1)                            # far east sheltered pad
locales.append(('4-frostbite-pass', 'Frostbite Pass', 1.6, (5.5, 7), 3,
  'Winter winds whip across the ridges. Use valleys for shelter and time the lulls to land.', d, {
    'theme': 'winter',
    'wind': {'baseAx': 16, 'gustAx': 100, 'period': 11, 'gustDuration': 3.5, 'warnDuration': 1.5, 'alternate': True},
  }))

# 5 — Singularity Station (80x36, 2.5x): orbital ring around a central micro-singularity.
e = L(80, 36)
# West dock
e.pad('1', 33, 2, 7, base=1); e.g[32][4] = 'S'
e.pad('T', 20, 2, 8, base=1)                              # west orbital teleport
e.pad('2', 8, 3, 8, base=1)                               # north-west ring pad
e.pad('F', 33, 12, 16, base=1)                            # south-west store
e.pad('3', 14, 15, 20, base=1)                            # inner-west platform
# North & south ring decks (wide open around center col 40, row 18)
e.pad('4', 6, 36, 43, base=1)                             # north zenith pad above core
e.pad('5', 33, 36, 43, base=1)                            # south nadir pad below core
e.fill(1, 3, 24, 25); e.fill(1, 3, 54, 55)                # structural ceiling ribs
e.fill(32, 34, 24, 25); e.fill(32, 34, 54, 55)            # structural floor ribs
# East dock
e.pad('6', 14, 59, 64, base=1)                            # inner-east platform
e.pad('7', 8, 70, 75, base=1)                             # north-east ring pad
e.pad('8', 22, 71, 76, base=1)                            # mid-east deck
e.pad('F', 33, 62, 66, base=1)                            # south-east store
e.pad('9', 33, 71, 76, base=1)                            # far south-east pad
locales.append(('5-singularity-station', 'Singularity Station', 2.5, (5.0, 7), 3,
  'A black hole pulls everything toward the center. Slingshot around the core—and stay out of the horizon.', e, {
    'theme': 'singularity',
    'gravityScale': 0.25,
    'gravityWells': [{'col': 40, 'row': 18, 'strength': 145, 'radius': 24, 'coreRadius': 2.0}],
  }))

# 6 — Polarity Yard (64x36, 2x): three magnetic bays (Normal, Low-G, Inverted Gravity).
f = L(64, 36)
# Bulkheads splitting west (1-20), center low-G (21-42), east inverted-G (43-62)
f.fill(1, 34, 20, 20); f.clear(6, 11, 20, 20); f.clear(23, 28, 20, 20)
f.fill(1, 34, 43, 43); f.clear(6, 11, 43, 43); f.clear(23, 28, 43, 43)
# West bay (normal gravity)
f.pad('1', 33, 2, 7, base=1); f.g[32][4] = 'S'
f.pad('T', 33, 11, 17, base=1)                            # west teleport
f.pad('2', 17, 3, 8, base=1)
f.pad('3', 8, 11, 16, base=1)
f.pad('F', 24, 2, 6, base=1)                              # west store
# Center atrium (low-G: 0.45x)
f.pad('4', 33, 24, 29, base=1)
f.pad('5', 20, 29, 34, base=1)                            # floating cargo island
f.pad('6', 9, 25, 30, base=1)
f.pad('F', 33, 35, 39, base=1)                            # center store
# East magnetic bay (inverted gravity: -0.45x — pulls upward! Use DOWN thrust to land)
f.pad('7', 33, 46, 51, base=1)
f.pad('8', 21, 53, 58, base=1)
f.pad('9', 11, 47, 52, base=1)
locales.append(('6-polarity-yard', 'Polarity Yard', 1.75, (5.5, 7), 3,
  'Normal, Low-G, and Inverted-G magnetic bays. In the magenta bay, use DOWN thrust to settle onto pads.', f, {
    'theme': 'polarity',
    'gravityZones': [
      {'c0': 21, 'r0': 1, 'c1': 42, 'r1': 34, 'gyScale': 0.45, 'label': 'LOW-G ATRIUM'},
      {'c0': 44, 'r0': 1, 'c1': 62, 'r1': 34, 'gyScale': -0.45, 'label': 'INVERTED MAG-BAY'},
    ],
  }))

# 7 — Gridlock Vault (96x36, 3x): timed laser gates & Electroid sliding-gap shafts with safe detours.
g = L(96, 36)
# West entry wing
g.pad('1', 33, 2, 7, base=1); g.g[32][4] = 'S'
g.pad('T', 33, 11, 17, base=1)
g.pad('2', 18, 3, 8, base=1)
g.pad('3', 8, 12, 17, base=1)
g.pad('F', 24, 19, 23, base=1)
# Wall 1 at col 29: shortcut gap at rows 15-21 (pulsing laser), safe high detour rows 2-6
g.fill(7, 34, 29, 29); g.clear(15, 21, 29, 29)
# Central security core (cols 30-64)
g.pad('4', 33, 33, 38, base=1)
g.pad('5', 14, 38, 43, base=1)
g.pad('6', 25, 48, 53, base=1)
g.fill(19, 19, 44, 60)                                    # mid security deck
g.pad('F', 33, 55, 59, base=1)
# Wall 2 at col 65: wide Electroid sliding-gap shaft (rows 8-26) + safe low detour rows 29-33
g.fill(1, 7, 65, 65); g.fill(27, 28, 65, 65)
# East treasury wing (cols 66-94)
g.pad('7', 10, 72, 77, base=1)
g.pad('8', 22, 78, 83, base=1)
g.pad('9', 33, 86, 91, base=1)
g.pad('T', 33, 72, 78, base=1)                            # east teleport
locales.append(('7-gridlock-vault', 'Gridlock Vault', 2.6, (4.8, 8), 4,
  'Timed laser gates and sliding Electroid barriers. Thread the shortcuts or take the safe detours.', g, {
    'theme': 'vault',
    'laserGates': [
      {'c0': 29, 'r0': 15, 'c1': 29, 'r1': 21, 'period': 6.0, 'onDuration': 2.2, 'warnDuration': 1.0, 'phase': 0.0},
      {'c0': 44, 'r0': 1, 'c1': 44, 'r1': 18, 'period': 7.5, 'onDuration': 0, 'warnDuration': 0, 'phase': 0.0, 'gapTiles': 5},
      {'c0': 65, 'r0': 8, 'c1': 65, 'r1': 26, 'period': 8.0, 'onDuration': 0, 'warnDuration': 0, 'phase': 2.0, 'gapTiles': 5},
      {'c0': 70, 'r0': 16, 'c1': 84, 'r1': 16, 'period': 6.5, 'onDuration': 2.0, 'warnDuration': 1.0, 'phase': 1.5},
    ],
  }))

# 8 — Overdrive Canyon (96x36, 3x): heavy gravity + turbo thrusters + diagonal meteor showers.
h = L(96, 36)
# West bunker & canyon floor
h.pad('1', 33, 2, 7, base=1); h.g[32][4] = 'S'
h.fill(24, 24, 1, 18)                                     # bunker overhang sheltering spawn & teleport
h.fill(22, 23, 13, 15); h.fill(21, 21, 14, 14)            # craggy rock fin atop west overhang
h.pad('T', 33, 10, 16, base=1)
h.pad('2', 14, 4, 9, base=1)                              # exposed west hoodoo (Mitten Saddle)
h.fill(10, 15, 2, 3); h.fill(12, 15, 10, 10)              # solid left Mitten cliff (meteor shield) + right thumb spire
h.pad('F', 33, 22, 26, base=1)                            # west canyon store
h.fill(31, 34, 21, 21)                                    # framing rock fin left of store
# Central spires & sheltered hoodoos
h.fill(18, 34, 32, 35); h.pad('3', 17, 31, 36, base=0)    # tall canyon spire
h.fill(31, 34, 31, 36); h.fill(33, 34, 30, 37)            # stepped talus base
h.fill(14, 17, 30, 30)                                    # solid left Mitten thumb spire
h.fill(10, 10, 40, 56); h.fill(11, 11, 40, 41); h.fill(11, 11, 55, 56); h.fill(9, 9, 44, 51)  # sculpted stone arch
h.pad('4', 18, 44, 49, base=1)                            # sheltered hoodoo under arch (Twin-Fin)
h.fill(15, 19, 42, 43); h.fill(16, 19, 50, 50)            # solid flanking Mitten wall + right thumb
h.pad('5', 33, 44, 49, base=1)                            # floor pad under arch
h.fill(31, 34, 42, 43)                                    # stepped rock shoulder left of pad 5
h.pad('6', 25, 58, 63, base=1)                            # mid hoodoo (Flanked Canyon Shelf)
h.fill(21, 26, 56, 57)                                    # solid left meteor-shield butte
# East mesas & stepped hoodoos
h.fill(15, 34, 69, 71); h.pad('7', 14, 68, 73, base=0)    # east spire
h.fill(31, 34, 68, 72); h.fill(33, 34, 67, 73)            # stepped talus base
h.fill(10, 15, 74, 74); h.fill(12, 15, 75, 75)            # solid stepped Mitten butte right of pad 7
h.fill(23, 23, 74, 92); h.fill(22, 22, 76, 80)            # sheltered east overhang with rock crown
h.pad('8', 32, 78, 83, base=2)                            # sheltered east canyon pad
h.pad('F', 12, 84, 88, base=1)                            # high-mesa store (Stepped Caprock Terrace)
h.fill(9, 13, 89, 90); h.fill(11, 13, 91, 91)             # solid stepped caprock terrace right of store
h.pad('9', 19, 86, 91, base=1)                            # east cliffside hoodoo
h.fill(17, 20, 85, 85)                                    # solid left fin framing pad 9
h.pad('T', 33, 60, 66, base=1)                            # second teleport
locales.append(('8-overdrive-canyon', 'Overdrive Canyon', 3.0, (4.5, 8), 4,
  'Turbo-charged thrusters, heavy gravity, and falling meteors. Watch your fuel—fares pay triple!', h, {
    'theme': 'canyon',
    'gravityScale': 1.35,
    'thrustScale': 1.45,
    'burnScale': 1.5,
    'maxSpeedScale': 1.35,
    'meteors': {'interval': 2.6, 'speed': 300, 'angleDeg': 68, 'radius': 9, 'maxActive': 4},
  }))

base_area = next(lv.C * lv.R for slug, _, _, _, _, _, lv, _ in locales if slug == '1-first-shift')
bad = False
for slug, name, mult, (interval, max_waiting), rivals, hint, lv, extra in locales:
    probs = check(lv, min_pads=3 if extra.get('noRivals') else 5)
    print(f'{slug} ({lv.C}x{lv.R}, {lv.C * lv.R / base_area:.2g}x area): {"OK" if not probs else probs}')
    bad |= bool(probs)
    # Passenger demand is per locale (a new passenger every ~interval s while fewer than
    # max_waiting wait), independent of how many taxis are around. Starting rivals scale with size.
    data = {'name': name, 'fareMultiplier': mult, 'passengerInterval': interval, 'maxWaiting': max_waiting,
            'rivals': rivals, 'hint': hint, 'tileSize': 40, 'tiles': lv.rows()}
    data.update(extra)
    json.dump(data, open(f'{OUT}/{slug}.json', 'w'), indent=2)
    if '-v' in sys.argv: print('\n'.join(lv.rows()))
sys.exit(1 if bad else 0)
