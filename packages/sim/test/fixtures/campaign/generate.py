"""
Generates the campaign levels and checks they're fair.

    python3 packages/sim/test/fixtures/campaign/generate.py packages/sim/test/fixtures/campaign [-v]

Every pad and the exit must be reachable from the spawn by a 2×2-tile box (the taxi is
48×34 in 40u tiles), so no passage is narrower or shorter than two tiles. `-v` prints maps.
"""
import json, sys
from collections import deque
OUT = sys.argv[1]

class L:
    def __init__(s, cols=32, rows=18):
        s.C, s.R = cols, rows
        s.g = [['.'] * cols for _ in range(rows)]
        s.fill(0, 0, 0, cols - 1); s.fill(rows - 1, rows - 1, 0, cols - 1)
        s.fill(0, rows - 1, 0, 0); s.fill(0, rows - 1, cols - 1, cols - 1)
    def fill(s, r0, r1, c0, c1, ch='#'):
        for r in range(r0, r1 + 1):
            for c in range(c0, c1 + 1): s.g[r][c] = ch
    def pad(s, label, row, c0, c1, base=1):
        """Pad surface tiles on `row`, with `base` rows of solid support below."""
        s.fill(row, row, c0, c1, label)
        if base: s.fill(row + 1, min(row + base, s.R - 1), c0, c1)
    def rows(s): return [''.join(r) for r in s.g]

def reachable(lv):
    """Problems found (empty = OK): unreachable pads/exit, pads narrower than 2 tiles."""
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
    problems = []
    # Pads are horizontal runs of the same character (two stores on one row are two pads).
    for r in range(R):
        c = 0
        while c < C:
            ch = g[r][c]
            if ch.isdigit() or ch in 'FT':
                c0 = c
                while c < C and g[r][c] == ch: c += 1
                c1 = c - 1
                if c1 - c0 + 1 < 2: problems.append(f'pad {ch} narrower than 2 tiles')
                # A reachable 2x2-tile space right above the pad also satisfies the gear rule (no
                # side jets once the gear starts down): 80u of headroom holds the 34u taxi while
                # it hovers lined up, lowers the gear and comes straight down.
                if not any((x, r - 2) in seen for x in range(c0, c1)): problems.append(f'pad {ch} @col {c0} unreachable')
            else:
                c += 1
    ex = [(r, c) for r in range(R) for c in range(C) if g[r][c] == 'E']
    er = ex[0][0]; ecs = [c for r, c in ex]
    if not any((c, er + 1) in seen for c in range(min(ecs), max(ecs))): problems.append('exit unreachable')
    return problems

levels = []

# Each level is about two screens of city. The original one-screen layout is the west half
# (cols 0–31); a new east district (cols 32–62) adds pads and a second store. Rival taxis
# allowed at once ramp up gently: 1, 1, 2, 2, 2, 2, 3, 3.

# 1 — First Shift: wide, low pads side by side; every trip is a short hop with headroom.
a = L(64, 18)
a.fill(0, 0, 13, 18, 'E')
a.pad('1', 14, 2, 7, base=2); a.g[13][4] = 'S'
a.pad('2', 12, 13, 18, base=0); a.fill(13, 16, 14, 17)
a.pad('3', 14, 24, 29, base=2)
a.pad('F', 15, 9, 11)
# east district: two more low pads and a second store
a.pad('4', 14, 36, 41, base=2)
a.pad('5', 12, 47, 52, base=0); a.fill(13, 16, 48, 51)
a.pad('F', 15, 57, 60)
a.pad('T', 14, 19, 22, base=2)   # teleport, between pads 2 and 3
levels.append(('01-first-shift', 'First Shift', 3, 1.0, 1,
  'Land beside the waving passenger, then fly them to the pad they ask for.', a))

# 2 — Downtown: towers split the city; pads on rooftops.
b = L(64, 18)
b.fill(0, 0, 3, 6, 'E')
b.fill(8, 16, 15, 16); b.pad('4', 7, 14, 17, base=0)
b.pad('1', 14, 2, 6, base=2); b.g[13][4] = 'S'
b.pad('2', 8, 3, 7)
b.pad('3', 13, 23, 27, base=3)
b.pad('F', 15, 9, 12)
b.fill(9, 9, 25, 30); b.pad('5', 8, 26, 29, base=0)
# east district: a second tower with a rooftop pad, a low pad, a floating pad, a store
b.fill(6, 16, 44, 45); b.pad('7', 5, 43, 46, base=0)
b.pad('6', 14, 35, 39, base=2)
b.pad('8', 10, 53, 57, base=1)
b.pad('F', 15, 58, 61)
b.pad('T', 15, 30, 33, base=1)   # teleport
levels.append(('02-downtown', 'Downtown', 4, 1.0, 1,
  'Towers split the city. Pick your route before you take off.', b))

# 3 — Awnings: pads tucked under overhangs; come in from the side.
c = L(64, 18)
c.fill(0, 0, 26, 29, 'E')
c.pad('1', 15, 2, 6); c.g[14][4] = 'S'
c.fill(10, 10, 1, 19); c.pad('2', 13, 13, 17, base=3)   # long awning over pads 1 and 2
c.fill(5, 5, 1, 8); c.pad('3', 8, 1, 5, base=1)          # pad 3 under a shelf
c.fill(6, 6, 22, 30); c.pad('4', 9, 24, 28, base=1)      # pad 4 under a shelf
c.pad('F', 15, 23, 26)
# east district: more shelves and awnings
c.fill(5, 5, 34, 50); c.pad('6', 9, 36, 40, base=1)      # under a long shelf
c.fill(11, 11, 43, 52); c.pad('7', 14, 45, 49, base=2)   # under an awning
c.pad('8', 4, 56, 59, base=1)                            # rooftop, open sky
c.pad('F', 15, 57, 60)
levels.append(('03-awnings', 'Awnings', 4, 1.0, 2,
  'Some pads hide under ledges. Drop below the ledge, then slide in sideways.', c))

# 4 — Elevator Shafts: columns joined at the top, pads at many heights. Narrower pads.
d = L(64, 18)
d.fill(0, 0, 14, 17, 'E')
d.fill(4, 16, 10, 10); d.fill(4, 16, 21, 21)
d.pad('1', 15, 2, 5); d.g[14][3] = 'S'
d.pad('2', 9, 6, 9, base=0)
d.pad('3', 12, 11, 14, base=0); d.pad('4', 7, 17, 20, base=0)
d.pad('5', 15, 14, 17)
d.pad('6', 10, 22, 25, base=0); d.pad('F', 15, 26, 29)
# east district: two more shafts
d.fill(4, 16, 42, 42); d.fill(4, 16, 53, 53)
d.pad('7', 9, 38, 41, base=0)
d.pad('8', 12, 43, 46, base=0); d.pad('9', 7, 49, 52, base=0)
d.pad('F', 15, 58, 61)
levels.append(('04-elevator-shafts', 'Elevator Shafts', 5, 1.0, 2,
  'Narrower pads. Line up first, then descend slowly.', d))

# 5 — Moonwalk: low gravity, floating platforms.
e = L(64, 18)
e.fill(0, 0, 4, 6, 'E')
e.pad('1', 15, 13, 17); e.g[14][15] = 'S'
e.pad('2', 11, 3, 5); e.pad('3', 6, 10, 12); e.pad('4', 9, 19, 21)
e.pad('5', 4, 25, 27); e.pad('6', 13, 25, 28); e.pad('F', 15, 2, 4)
e.fill(13, 13, 8, 9); e.fill(7, 7, 15, 16); e.fill(11, 11, 14, 15)
# east district: more floating islands
e.pad('7', 10, 36, 38); e.pad('8', 5, 44, 46); e.pad('9', 13, 50, 53)
e.fill(8, 8, 40, 41); e.fill(11, 11, 46, 47); e.fill(6, 6, 55, 57)
e.pad('F', 15, 58, 60)
levels.append(('05-moonwalk', 'Moonwalk', 5, 0.55, 2,
  'Low gravity! Small taps go a long way, and so does momentum.', e))

# 6 — Tight Squeeze: corridors two to three tiles wide.
f = L(64, 18)
f.fill(0, 0, 28, 30, 'E')
f.pad('1', 15, 2, 5); f.g[14][3] = 'S'
f.fill(4, 13, 8, 9)                          # wall with a gap at the bottom
f.fill(1, 2, 13, 14); f.fill(6, 16, 13, 14)  # wall with a gap at rows 3–5
f.fill(4, 13, 19, 20)
f.fill(1, 10, 26, 27)   # leaves a 2-tile passage (cols 24–25) past pad 6
f.pad('2', 6, 2, 5); f.pad('3', 15, 10, 12)
f.pad('4', 10, 15, 17, base=0); f.fill(11, 16, 16, 16)
f.pad('5', 15, 21, 24); f.pad('6', 5, 21, 23); f.pad('F', 15, 27, 29)
# east district: alternating walls with gaps below / above / below
f.fill(1, 12, 36, 37)                        # gap below (rows 13–16)
f.fill(5, 16, 44, 45)                        # gap above (rows 1–4)
f.fill(1, 11, 52, 53)                        # gap below (rows 12–16)
f.pad('7', 15, 39, 42)
f.pad('8', 8, 38, 40)                        # leaves cols 41–43 to fly past
f.pad('9', 15, 55, 58)
f.pad('F', 6, 57, 60)
levels.append(('06-tight-squeeze', 'Tight Squeeze', 5, 1.0, 2,
  'Narrow gaps. Gear up to fly faster, gear down before you land.', f))

# 7 — Heavy Load: high gravity, stacked ledges; fuel matters.
g = L(64, 18)
g.fill(0, 0, 14, 16, 'E')
g.pad('1', 15, 2, 5); g.g[14][3] = 'S'
g.pad('2', 11, 7, 9); g.pad('3', 7, 2, 4)
g.fill(5, 16, 12, 12); g.fill(5, 16, 19, 19)
g.pad('4', 13, 13, 15, base=0); g.pad('5', 8, 16, 18, base=0)
g.pad('6', 12, 22, 24); g.pad('7', 6, 26, 29); g.pad('F', 15, 26, 29)
# east district
g.fill(5, 16, 44, 44)
g.pad('8', 11, 36, 38); g.pad('9', 7, 40, 43, base=0)
g.fill(10, 10, 50, 55)
g.pad('F', 15, 56, 59)
levels.append(('07-heavy-load', 'Heavy Load', 6, 1.3, 3,
  'Heavy gravity. Keep the throttle up and watch your fuel.', g))

# 8 — Rush Hour: a big city (72×36). The original 48×27 block sits top-left; below it a lower
# district, to the east another.
h = L(72, 36)
h.fill(0, 0, 22, 25, 'E')
h.pad('1', 24, 2, 5); h.g[23][3] = 'S'
h.fill(14, 25, 9, 10); h.pad('2', 13, 8, 11, base=0)
h.pad('3', 7, 2, 5)
h.fill(5, 6, 14, 30); h.pad('4', 4, 18, 21, base=0)
h.fill(16, 25, 20, 23); h.pad('5', 15, 20, 23, base=0)
h.fill(11, 11, 28, 36); h.pad('6', 10, 31, 34, base=0)
h.fill(11, 25, 39, 40)   # starts at row 11: a 3-row passage under pad 7's base leads to pad 8
h.pad('7', 6, 42, 45); h.pad('8', 20, 42, 45); h.pad('F', 24, 30, 33)
h.fill(18, 18, 12, 16)
# lower district (rows 26–34)
h.pad('9', 33, 10, 14)
h.fill(29, 34, 24, 26)
h.fill(30, 30, 34, 44)
h.pad('F', 33, 60, 63)
# east district (cols 48–70)
h.fill(6, 24, 55, 55)
h.fill(12, 12, 58, 66)
h.fill(20, 20, 60, 69)
h.fill(27, 27, 50, 58)
h.pad('T', 33, 46, 49, base=1)   # teleport, lower district
levels.append(('08-rush-hour', 'Rush Hour', 7, 1.0, 3,
  'A city bigger than your screen. Follow the arrows at the edge.', h))

bad = False
for slug, name, fares, grav, rivals, hint, lv in levels:
    probs = reachable(lv)
    print(f'{slug} ({lv.C}x{lv.R}): {"OK" if not probs else probs}')
    bad |= bool(probs)
    data = {'name': name, 'fares': fares, 'rivals': rivals, 'hint': hint, 'tileSize': 40, 'tiles': lv.rows()}
    if grav != 1.0: data['gravityScale'] = grav
    json.dump(data, open(f'{OUT}/{slug}.json', 'w'), indent=2)
    if '-v' in sys.argv: print('\n'.join(lv.rows()))
sys.exit(1 if bad else 0)
