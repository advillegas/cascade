'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

const GRID = 8;

// Shape catalog tiered by difficulty. Higher tiers have more cells and/or
// awkward profiles that demand cleaner board state to place.
//   T1 — trivial fillers  (1–2 cells, 2×2)
//   T2 — standard         (3-cell L/I, basic tetrominoes)
//   T3 — hard             (4–5 cell L/I, U/V/T pentominoes)
//   T4 — brutal           (5+ cell awkward pentominoes, 3×3 square)

// Normalize a cell list so its bounding box starts at (0,0) and the cells
// are sorted — gives us a stable key for dedup across rotations/mirrors.
const normalizeCells = (cells) => {
  let minR = Infinity, minC = Infinity;
  for (const [r, c] of cells) {
    if (r < minR) minR = r;
    if (c < minC) minC = c;
  }
  return cells
    .map(([r, c]) => [r - minR, c - minC])
    .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
};

// Generate every unique orientation of a shape: 4 rotations × 2 mirror states.
// Returns up to 8 unique cell lists. Symmetric pieces collapse naturally.
const expandShape = (base) => {
  const out = [];
  const seen = new Set();
  const variants = [
    base,
    base.map(([r, c]) => [r, -c]),  // horizontal mirror
  ];
  for (const v of variants) {
    let cur = v;
    for (let i = 0; i < 4; i++) {
      const norm = normalizeCells(cur);
      const k = JSON.stringify(norm);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(norm);
      }
      cur = rotateCells(cur);
    }
  }
  return out;
};

// Each canonical piece is auto-expanded to all unique rotations + mirrors,
// so players see L/J, S/Z, F/F-mirror, N/N-mirror etc. all from one entry.
const SHAPES_T1 = [
  ...expandShape([[0,0]]),                        // single
  ...expandShape([[0,0],[0,1]]),                  // domino
  ...expandShape([[0,0],[1,1]]),                  // diagonal
  ...expandShape([[0,0],[0,1],[1,0],[1,1]]),      // 2×2 square
];

const SHAPES_T2 = [
  ...expandShape([[0,0],[0,1],[0,2]]),            // I-3 (2 orientations)
  ...expandShape([[0,0],[1,0],[1,1]]),            // L-3 (4)
  ...expandShape([[0,0],[0,1],[0,2],[1,0]]),      // L/J-tetromino (8)
  ...expandShape([[0,0],[1,0],[1,1],[2,0]]),      // T-tetromino (4)
  ...expandShape([[0,1],[0,2],[1,0],[1,1]]),      // S/Z-tetromino (4)
];

const SHAPES_T3 = [
  ...expandShape([[0,0],[0,1],[0,2],[0,3]]),            // I-4 (2)
  ...expandShape([[0,0],[1,0],[2,0],[2,1],[2,2]]),      // big L/J-pent (8)
  ...expandShape([[0,0],[0,1],[0,2],[1,0],[2,0]]),      // V-pent (4)
  ...expandShape([[0,0],[0,1],[0,2],[1,1]]),            // T-pent small (4)
  ...expandShape([[0,0],[0,1],[0,2],[0,3],[1,1]]),      // Y-pent (8)
  ...expandShape([[0,0],[0,1],[0,2],[1,2],[2,2]]),      // big-J corner pent (8 — partial dup)
  // Classic T-pentomino: 3-wide top bar with a 2-cell stem down the middle.
  ...expandShape([[0,0],[0,1],[0,2],[1,1],[2,1]]),
];

const SHAPES_T4 = [
  ...expandShape([[0,0],[0,1],[0,2],[0,3],[0,4]]),      // I-5 (2)
  // 3×3 square — perfectly symmetric, only one orientation.
  [[0,0],[0,1],[0,2],[1,0],[1,1],[1,2],[2,0],[2,1],[2,2]],
  // X-pentomino (plus sign) — symmetric, only one orientation.
  ...expandShape([[0,1],[1,0],[1,1],[1,2],[2,1]]),
  // F-pentomino (8 orientations — F + F-mirror, all rotations)
  ...expandShape([[0,1],[0,2],[1,0],[1,1],[2,1]]),
  // N-pentomino (8 orientations)
  ...expandShape([[0,1],[1,1],[2,0],[2,1],[3,0]]),
  // W-pentomino (4 orientations)
  ...expandShape([[0,0],[1,0],[1,1],[2,1],[2,2]]),
  // Z-pentomino (4 orientations)
  ...expandShape([[0,0],[0,1],[1,1],[2,1],[2,2]]),
  // U-pentomino (4 orientations)
  ...expandShape([[0,0],[0,2],[1,0],[1,1],[1,2]]),
];

const SHAPE_TIERS = [SHAPES_T1, SHAPES_T2, SHAPES_T3, SHAPES_T4];

// Steep weight curve. Returns weights for [T1, T2, T3, T4] at the given level.
// T4 starts appearing at L3, dominates by L7.
const tierWeights = (lvl) => {
  const L = Math.max(1, lvl);
  const t1 = Math.max(0.05, 1.0 - L * 0.18);
  const t2 = 0.35;
  const t3 = Math.min(0.45, 0.05 + L * 0.06);
  const t4 = Math.min(0.45, Math.max(0, (L - 2) * 0.09));
  return [t1, t2, t3, t4];
};

const pickTier = (lvl) => {
  const w = tierWeights(lvl);
  const total = w.reduce((s, x) => s + x, 0);
  let r = Math.random() * total;
  for (let i = 0; i < w.length; i++) {
    r -= w[i];
    if (r <= 0) return i;
  }
  return w.length - 1;
};

// Diamond cells take 2 clears to break. Spawn rate scales with level.
// 0% at L1, +2% per level, capped at 22% at L11+.
const diamondChance = (lvl) =>
  Math.min(0.22, Math.max(0, (lvl - 1) * 0.02));

const PALETTE = [
  { main: '#ff2e6e', light: '#ff7aa4', dark: '#a30d43' },
  { main: '#00d4ff', light: '#7aeaff', dark: '#007a94' },
  { main: '#ffd60a', light: '#ffe878', dark: '#a38800' },
  { main: '#ff7b2e', light: '#ffad7a', dark: '#a3470d' },
  { main: '#a855f7', light: '#cb91fb', dark: '#6820b8' },
  { main: '#22d65f', light: '#7aeb9e', dark: '#0d8f3a' },
  { main: '#00ffc2', light: '#7affdf', dark: '#00a37e' },
];

// Powerups that can spawn on a freshly-placed block cell and trigger when cleared
const POWERUPS = [
  { type: 'BLAST',   glyph: '✦', color: '#ff7b2e', weight: 35 },
  { type: 'SHUFFLE', glyph: '⟲', color: '#00d4ff', weight: 18 },
  { type: 'GRAVITY', glyph: '⬢', color: '#a855f7', weight: 15 },
  { type: 'MULT2',   glyph: '×2', color: '#ffd60a', weight: 18, mult: 2 },
  { type: 'MULT3',   glyph: '×3', color: '#ff2e6e', weight: 9,  mult: 3 },
  { type: 'MULT4',   glyph: '×4', color: '#cb91fb', weight: 5,  mult: 4 },
];
const POWERUP_WEIGHT_TOTAL = POWERUPS.reduce((s, p) => s + p.weight, 0);
const POWERUP_SPAWN_CHANCE = 0.06; // ~6% of placements spawn one powerup

const pickPowerup = () => {
  let r = Math.random() * POWERUP_WEIGHT_TOTAL;
  for (const p of POWERUPS) {
    r -= p.weight;
    if (r <= 0) return p;
  }
  return POWERUPS[0];
};

// Per-level visual themes — background gradient + accent color. Cycles through levels.
const LEVEL_THEMES = [
  { name: 'NEON',      bg: 'radial-gradient(ellipse at top, #1a1440 0%, #0a0818 55%, #050410 100%)', accent: '#a855f7', glow: 'rgba(168,85,247,0.3)' },
  { name: 'OCEAN',     bg: 'radial-gradient(ellipse at top, #0a2a4a 0%, #051a2a 55%, #020a14 100%)', accent: '#00d4ff', glow: 'rgba(0,212,255,0.3)' },
  { name: 'SUNSET',    bg: 'radial-gradient(ellipse at top, #4a1a2e 0%, #2a0a1a 55%, #140510 100%)', accent: '#ff7b2e', glow: 'rgba(255,123,46,0.3)' },
  { name: 'FOREST',    bg: 'radial-gradient(ellipse at top, #0a3a1a 0%, #051a0a 55%, #020a05 100%)', accent: '#22d65f', glow: 'rgba(34,214,95,0.3)' },
  { name: 'VAPORWAVE', bg: 'radial-gradient(ellipse at top, #3a0a3a 0%, #1a041a 55%, #0a020a 100%)', accent: '#ff2e6e', glow: 'rgba(255,46,110,0.3)' },
  { name: 'GOLDRUSH',  bg: 'radial-gradient(ellipse at top, #4a3a0a 0%, #1a1405 55%, #0a0702 100%)', accent: '#ffd60a', glow: 'rgba(255,214,10,0.3)' },
  { name: 'AURORA',    bg: 'radial-gradient(ellipse at top, #0a4a3a 0%, #051a14 55%, #02140a 100%)', accent: '#00ffc2', glow: 'rgba(0,255,194,0.3)' },
  { name: 'MIDNIGHT',  bg: 'radial-gradient(ellipse at top, #1a0a4a 0%, #0a041a 55%, #05020a 100%)', accent: '#7aeaff', glow: 'rgba(122,234,255,0.3)' },
];
const themeForLevel = (lvl) => LEVEL_THEMES[(lvl - 1) % LEVEL_THEMES.length];
const DEFAULT_BG = LEVEL_THEMES[0].bg;

// Game modes. "hasLevels" modes track progress per level; endless and snake are score-based.
// Timed-mode tuning (all in seconds).
const TIMED_START = 30;       // starting clock
const TIMED_MAX = 99;         // cap so players can't bank forever
const TIMED_PER_PLACE = 1.5;  // every block placement
const TIMED_PER_CLEAR = 3;    // each line/column cleared
const TIMED_PER_SNAKE_EAT = 1;

const MODES = {
  // Kept id=endless for save-state compatibility; presented as CLASSIC in UI.
  endless: {
    id: 'endless',
    label: 'CLASSIC',
    tagline: 'No timer. Chase the high score.',
    glyph: '∞',
    gradient: 'linear-gradient(135deg, #00d4ff, #a855f7)',
    border: 'rgba(168,85,247,0.5)',
    hasLevels: false,
  },
  goal: {
    id: 'goal',
    label: 'BLOCK GOAL',
    tagline: 'Clear a target number of blocks.',
    glyph: '◆',
    gradient: 'linear-gradient(135deg, #22d65f, #00d4ff)',
    border: 'rgba(34,214,95,0.5)',
    hasLevels: true,
    levelConfig: (lvl) => ({
      target: 25 + Math.floor(lvl * 12),
      label: `Clear ${25 + Math.floor(lvl * 12)} blocks`,
    }),
  },
  // Redesigned: continuous countdown. Every placement + clear + snake eat
  // adds time. Overdrive and snake mode freeze the timer (can't lose).
  timed: {
    id: 'timed',
    label: 'TIMED',
    tagline: 'Countdown. Place blocks and clear lines to bank time.',
    glyph: '◷',
    gradient: 'linear-gradient(135deg, #ff7b2e, #ff2e6e)',
    border: 'rgba(255,123,46,0.5)',
    hasLevels: false,
  },
  treasure: {
    id: 'treasure',
    label: 'TREASURE',
    tagline: 'Clear all gems on a pre-filled board.',
    glyph: '★',
    gradient: 'linear-gradient(135deg, #ffd60a, #ff7b2e)',
    border: 'rgba(255,214,10,0.5)',
    hasLevels: true,
    levelConfig: (lvl) => ({
      gems: Math.min(3 + lvl, 12),
      prefillDensity: Math.min(0.15 + lvl * 0.02, 0.35),
      label: `Clear ${Math.min(3 + lvl, 12)} gems`,
    }),
  },
  snake: {
    id: 'snake',
    label: 'SNAKE',
    tagline: 'Bonus mode. Classic snake on the grid.',
    glyph: '◉',
    gradient: 'linear-gradient(135deg, #22d65f, #0d8f3a)',
    border: 'rgba(34,214,95,0.5)',
    hasLevels: false,
    alt: true,
  },
};
const MODE_LIST = ['endless', 'goal', 'timed', 'treasure', 'snake'];

const rand = () => Math.random().toString(36).slice(2, 9);

// Optional `level` arg drives shape difficulty + diamond chance. Defaults
// to L1 (T1-heavy, no diamonds) so legacy call sites stay safe.
const makePiece = (level = 1) => {
  const tier = SHAPE_TIERS[pickTier(level)];
  const cells = tier[Math.floor(Math.random() * tier.length)];
  // Diamond cell: hp=2 marker on at most one cell of the piece.
  const dChance = diamondChance(level);
  let diamondAt = -1;
  if (cells.length > 1 && Math.random() < dChance) {
    diamondAt = Math.floor(Math.random() * cells.length);
  }
  return {
    id: rand(),
    cells,
    color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    diamondAt,
  };
};
const newTray = (level = 1) => [makePiece(level), makePiece(level), makePiece(level)];

// Hoisted via `function` so the SHAPES catalog (above) can call it from
// expandShape during module load — `const = (...) =>` would TDZ-error here.
function rotateCells(cells) {
  let maxR = 0;
  for (const [r] of cells) if (r > maxR) maxR = r;
  const rotated = cells.map(([r, c]) => [c, maxR - r]);
  let minR = Infinity, minC = Infinity;
  for (const [r, c] of rotated) {
    if (r < minR) minR = r;
    if (c < minC) minC = c;
  }
  return rotated.map(([r, c]) => [r - minR, c - minC]);
}
const dims = (cells) => {
  let mr = 0, mc = 0;
  for (const [r, c] of cells) { if (r > mr) mr = r; if (c > mc) mc = c; }
  return { rows: mr + 1, cols: mc + 1 };
};
const emptyBoard = () => Array.from({ length: GRID }, () => Array(GRID).fill(null));

// SHUFFLE powerup: randomize positions of all currently-filled cells
const shuffleBoard = (b) => {
  const cells = [];
  for (let r = 0; r < GRID; r++)
    for (let c = 0; c < GRID; c++)
      if (b[r][c]) cells.push(b[r][c]);
  // Pick random destination positions
  const slots = [];
  for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) slots.push([r, c]);
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  const nb = emptyBoard();
  cells.forEach((cell, i) => { const [r, c] = slots[i]; nb[r][c] = cell; });
  return nb;
};

// GRAVITY powerup: pack all filled cells into a dense cluster near the center
const gravityStack = (b) => {
  const cells = [];
  for (let r = 0; r < GRID; r++)
    for (let c = 0; c < GRID; c++)
      if (b[r][c]) cells.push(b[r][c]);
  const center = (GRID - 1) / 2;
  const positions = [];
  for (let r = 0; r < GRID; r++) {
    for (let c = 0; c < GRID; c++) {
      const d = (r - center) ** 2 + (c - center) ** 2;
      positions.push({ r, c, d });
    }
  }
  positions.sort((a, b2) => a.d - b2.d);
  const nb = emptyBoard();
  for (let i = 0; i < cells.length && i < positions.length; i++) {
    const { r, c } = positions[i];
    nb[r][c] = cells[i];
  }
  return nb;
};

// Synthwave chord progression in A minor: Am - F - C - G
// Each chord gets 8 eighth-note arpeggio steps; bass hits on steps 0 and 4
const MUSIC_CHORDS = [
  { bass: 110.00, arp: [220.00, 329.63, 261.63, 329.63, 440.00, 329.63, 261.63, 329.63] }, // Am
  { bass:  87.31, arp: [174.61, 261.63, 220.00, 261.63, 349.23, 261.63, 220.00, 261.63] }, // F
  { bass:  65.41, arp: [130.81, 196.00, 164.81, 196.00, 261.63, 196.00, 164.81, 196.00] }, // C
  { bass:  98.00, arp: [196.00, 293.66, 246.94, 293.66, 392.00, 293.66, 246.94, 293.66] }, // G
];
const MUSIC_STEP_MS = 255;
const MUSIC_STEP_MS_DANGER = 175;

function getMultiplier(streak) {
  if (streak <= 1) return 1;
  if (streak === 2) return 1.5;
  if (streak === 3) return 2;
  if (streak === 4) return 3;
  if (streak === 5) return 4;
  return 5;
}

function mulColor(mul) {
  if (mul <= 1) return '#7aeaff';
  if (mul <= 1.5) return '#22d65f';
  if (mul <= 2) return '#ffd60a';
  if (mul <= 3) return '#ff7b2e';
  if (mul <= 4) return '#ff2e6e';
  return '#a855f7';
}

function Block({ color, size, clearing, cracking, ghost, fresh, powerup, fill, diamond }) {
  const c = color;
  // Diamond block: cyan/white gem palette overrides piece color so they pop.
  const diamondPristine = diamond === 2;
  // Show the cracked overlay either when state already has hp=1, OR while
  // we're mid-cracking-animation (state hasn't decremented yet).
  const diamondCracked = diamond === 1 || cracking;
  const isDiamond = diamondPristine || diamondCracked;
  const dGlow = (diamondPristine && !cracking) ? '#7aeaff' : '#ff7aa4';
  return (
    <div
      style={{
        position: 'relative',
        width: fill ? '100%' : size,
        height: fill ? '100%' : size,
        background: ghost
          ? `linear-gradient(135deg, ${c.light}55, ${c.main}44)`
          : isDiamond
          ? `linear-gradient(135deg, #e8fbff 0%, #7aeaff 45%, #00d4ff 100%)`
          : `linear-gradient(135deg, ${c.light} 0%, ${c.main} 55%, ${c.dark} 100%)`,
        borderRadius: size * 0.18,
        boxShadow: ghost
          ? `inset 0 0 0 2px ${c.main}99`
          : `inset ${size*0.08}px ${size*0.08}px 0 rgba(255,255,255,0.3),
             inset -${size*0.06}px -${size*0.06}px 0 rgba(0,0,0,0.28),
             0 ${size*0.05}px ${size*0.12}px rgba(0,0,0,0.4)${powerup ? `, 0 0 ${size*0.5}px ${powerup.color}cc` : ''}${isDiamond ? `, 0 0 ${size*0.45}px ${dGlow}cc, inset 0 0 ${size*0.15}px rgba(255,255,255,0.6)` : ''}`,
        opacity: ghost ? 0.55 : 1,
        // Cracking diamonds STAY in place — shake them instead of scale-to-zero.
        transform: (clearing && !cracking) ? 'scale(0) rotate(180deg)' : 'scale(1) rotate(0)',
        transition: (clearing && !cracking) ? 'transform 400ms cubic-bezier(.5,-0.3,.3,1.5), opacity 350ms' : 'transform 200ms',
        animation: fresh
          ? 'blockSpawn 320ms cubic-bezier(.3,1.6,.5,1) both'
          : cracking
          ? 'diamondCrack 440ms cubic-bezier(.36,.07,.19,.97) both'
          : 'none',
        overflow: 'hidden',
      }}
    >
      {/* Diamond — top-view of a brilliant cut: 8 pinwheel facets + bright table */}
      {isDiamond && !ghost && (
        <>
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
          >
            {/* 8 triangular facets pinwheeling around center.
                Solid fills with alpha so the cyan base shows through,
                simulating refraction. Bright + dim alternate. */}
            <polygon points="0,0 50,0 50,50"     fill="rgba(255,255,255,0.85)" />
            <polygon points="50,0 100,0 50,50"   fill="rgba(0,160,210,0.55)"   />
            <polygon points="100,0 100,50 50,50" fill="rgba(255,255,255,0.55)" />
            <polygon points="100,50 100,100 50,50" fill="rgba(0,90,140,0.65)"  />
            <polygon points="100,100 50,100 50,50" fill="rgba(255,255,255,0.7)" />
            <polygon points="50,100 0,100 50,50" fill="rgba(0,160,210,0.55)"   />
            <polygon points="0,100 0,50 50,50"   fill="rgba(255,255,255,0.45)" />
            <polygon points="0,50 0,0 50,50"     fill="rgba(0,90,140,0.65)"    />
            {/* Facet edges — thin lines that catch the eye like real cut lines */}
            <g stroke="rgba(255,255,255,0.9)" strokeWidth="0.6" fill="none">
              <line x1="0"   y1="0"   x2="50" y2="50" />
              <line x1="100" y1="0"   x2="50" y2="50" />
              <line x1="100" y1="100" x2="50" y2="50" />
              <line x1="0"   y1="100" x2="50" y2="50" />
              <line x1="50"  y1="0"   x2="50" y2="50" />
              <line x1="100" y1="50"  x2="50" y2="50" />
              <line x1="50"  y1="100" x2="50" y2="50" />
              <line x1="0"   y1="50"  x2="50" y2="50" />
            </g>
            {/* Central table — bright square that glints */}
            <rect
              x="36" y="36" width="28" height="28" rx="3"
              fill="rgba(255,255,255,0.55)"
              stroke="rgba(255,255,255,0.9)"
              strokeWidth="0.5"
            />
            <rect
              x="44" y="44" width="12" height="12" rx="2"
              fill="#ffffff"
              opacity="0.9"
            >
              <animate attributeName="opacity" values="0.5;1;0.5" dur="1.6s" repeatCount="indefinite" />
            </rect>
          </svg>
          {/* Cracked overlay — jagged fracture with branches and a hairline highlight */}
          {diamondCracked && (
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
            >
              {/* Main fracture */}
              <polyline
                points="8,18 26,32 19,48 42,54 34,72 52,82 44,96"
                fill="none"
                stroke="rgba(8,4,18,0.92)"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Side branch */}
              <polyline
                points="42,54 62,50 76,64 70,82"
                fill="none"
                stroke="rgba(8,4,18,0.85)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Smaller offshoot */}
              <polyline
                points="62,50 78,38 88,44"
                fill="none"
                stroke="rgba(8,4,18,0.7)"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Hairline highlight along the main fracture for depth */}
              <polyline
                points="8,18 26,32 19,48 42,54 34,72 52,82 44,96"
                fill="none"
                stroke="rgba(255,255,255,0.55)"
                strokeWidth="0.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </>
      )}
      {powerup && !ghost && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: '"Rubik Mono One", monospace',
          fontSize: powerup.glyph.length > 1 ? size * 0.42 : size * 0.6,
          fontWeight: 900,
          color: '#fff',
          textShadow: `0 0 ${size*0.15}px ${powerup.color}, 0 0 ${size*0.3}px ${powerup.color}, 0 1px 2px rgba(0,0,0,0.5)`,
          animation: 'powerupPulse 900ms ease-in-out infinite',
          pointerEvents: 'none',
        }}>
          {powerup.glyph}
        </div>
      )}
    </div>
  );
}

function TrayPiece({ piece, faded, onPointerDown, slotSize, enterKey }) {
  if (!piece) return <div style={{ width: '100%', aspectRatio: '1 / 1' }} />;
  const d = dims(piece.cells);
  const maxDim = Math.max(d.rows, d.cols);
  const cell = Math.min(slotSize / (maxDim + 0.5), 32);
  const w = d.cols * cell;
  const h = d.rows * cell;
  return (
    <div
      onPointerDown={onPointerDown}
      style={{
        width: '100%',
        aspectRatio: '1 / 1',
        display: 'grid',
        placeItems: 'center',
        touchAction: 'none',
        cursor: faded ? 'default' : 'grab',
        opacity: faded ? 0.15 : 1,
        transition: 'opacity 200ms',
        animation: 'trayEnter 400ms cubic-bezier(.3,1.6,.5,1) both, trayIdle 3s ease-in-out 500ms infinite',
      }}
    >
      <div style={{ position: 'relative', width: w, height: h }}>
        {piece.cells.map(([r, c], i) => (
          <div key={i} style={{
            position: 'absolute',
            top: r * cell,
            left: c * cell,
            padding: cell * 0.06,
          }}>
            <Block
              color={piece.color}
              size={cell - cell * 0.12}
              diamond={piece.diamondAt === i ? 2 : undefined}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [board, setBoard] = useState(emptyBoard);
  const boardStateRef = useRef(null);
  const [tray, setTray] = useState(newTray);
  const [trayKey, setTrayKey] = useState(0);
  const [score, setScore] = useState(0);
  const [displayScore, setDisplayScore] = useState(0);
  const [best, setBest] = useState(0);
  const [streak, setStreak] = useState(0);
  const [clearCount, setClearCount] = useState(0);
  const [clearing, setClearing] = useState({ rows: [], cols: [] });
  const [gameOver, setGameOver] = useState(false);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  const pauseStartRef = useRef(0);
  useEffect(() => { pausedRef.current = paused; }, [paused]);

  // Toggle pause and shift any absolute-timestamp timers (overdrive) forward
  // by the paused duration so they resume where they left off.
  const togglePause = () => {
    setPaused(p => {
      const now = Date.now();
      if (!p) {
        // Entering pause
        pauseStartRef.current = now;
      } else {
        // Leaving pause — advance overdrive deadline
        const elapsed = now - pauseStartRef.current;
        pauseStartRef.current = 0;
        setOverdriveEndsAt(e => e ? e + elapsed : null);
      }
      return !p;
    });
  };
  const [drag, setDrag] = useState(null);
  const [preview, setPreview] = useState(null);
  const [toast, setToast] = useState(null);
  const [boardCell, setBoardCell] = useState(40);
  const [popups, setPopups] = useState([]);
  const [particles, setParticles] = useState([]);
  const [freshCells, setFreshCells] = useState(new Set());
  const [muted, setMuted] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);
  const [shakeLevel, setShakeLevel] = useState(1);

  // OVERDRIVE: a limited-charge powerup the player activates on demand.
  // Grants 10 seconds where every dragged piece snaps to the optimal placement.
  const [overdriveCharges, setOverdriveCharges] = useState(2);
  const [overdriveEndsAt, setOverdriveEndsAt] = useState(null);
  const [nowTick, setNowTick] = useState(Date.now());

  // POWER PLACER: single-use charge that flood-fills the entire connected
  // cluster when the next piece is placed. Earned randomly (3% per placement) or from shop.
  const [powerPlacerCharges, setPowerPlacerCharges] = useState(0);
  const [powerPlacerPending, setPowerPlacerPending] = useState(false);

  // SNAKE: retro snake minigame that eats blocks off the board
  const [snakeCharges, setSnakeCharges] = useState(0);
  const [snakeActive, setSnakeActive] = useState(false);
  const [snakeBody, setSnakeBody] = useState([]);      // [{r,c}], head first
  const [snakeDir, setSnakeDir] = useState('right');
  const [snakeEaten, setSnakeEaten] = useState(0);
  const [snakeScore, setSnakeScore] = useState(0);
  const snakeBodyRef = useRef([]);
  const snakeDirRef = useRef('right');
  const snakeQueuedRef = useRef(null);
  const snakeActiveRef = useRef(false);
  const snakeEatenRef = useRef(0);
  const snakeScoreRef = useRef(0);
  const snakeSwipeStartRef = useRef(null);

  // META state (persists across games via window.storage)
  const [screen, setScreen] = useState('menu'); // 'menu' | 'game' | 'shop' | 'stats'
  const [coins, setCoins] = useState(0);
  const [persistedBest, setPersistedBest] = useState(0);
  const [gamesPlayed, setGamesPlayed] = useState(0);
  const [lifetimeClears, setLifetimeClears] = useState(0);
  const [lifetimeCoinsEarned, setLifetimeCoinsEarned] = useState(0);
  const [lastDailyClaim, setLastDailyClaim] = useState(0);
  const [metaLoaded, setMetaLoaded] = useState(false);
  const [coinsEarnedThisGame, setCoinsEarnedThisGame] = useState(0);
  const [usedContinue, setUsedContinue] = useState(false); // only one continue per game

  // NEW addictive systems
  const [xp, setXp] = useState(0);
  const [playStreak, setPlayStreak] = useState(0);
  const [lastPlayDate, setLastPlayDate] = useState(0);
  const [celebration, setCelebration] = useState(null); // full-screen banner
  const [flyingCoins, setFlyingCoins] = useState([]);
  const [milestonesHit, setMilestonesHit] = useState([]);
  const xpRef = useRef(0);
  const streakCheckedRef = useRef(false); // only check streak once per session

  // GAME MODES
  const [mode, setMode] = useState('endless'); // 'endless' | 'goal' | 'timed' | 'treasure' | 'snake'
  const [modeLevel, setModeLevel] = useState(1);
  const [levelBlocks, setLevelBlocks] = useState(0); // blocks cleared this level (goal mode)
  const [timeRemaining, setTimeRemaining] = useState(0); // seconds, timed mode
  const timeRemainingRef = useRef(0);
  const [levelComplete, setLevelComplete] = useState(false);
  // Persistent: highest level reached per mode
  const [modeProgress, setModeProgress] = useState({ goal: 1, timed: 1, treasure: 1 });
  const [modeBests, setModeBests] = useState({ endless: 0, timed: 0, snake: 0 }); // high scores for score modes
  const modeRef = useRef('endless');
  useEffect(() => { modeRef.current = mode; }, [mode]);

  // Load persisted state once on mount
  useEffect(() => {
    (async () => {
      try {
        const keys = ['coins','best','gamesPlayed','lifetimeClears','lifetimeCoins','lastDaily','pp','od','muted','xp','streak','lastPlay','snake'];
        const vals = await Promise.all(keys.map(k => window.storage.get(k).catch(() => null)));
        const get = (i) => vals[i]?.value;
        if (get(0) != null) setCoins(parseInt(get(0)) || 0);
        if (get(1) != null) { const b = parseInt(get(1)) || 0; setPersistedBest(b); setBest(b); }
        if (get(2) != null) setGamesPlayed(parseInt(get(2)) || 0);
        if (get(3) != null) setLifetimeClears(parseInt(get(3)) || 0);
        if (get(4) != null) setLifetimeCoinsEarned(parseInt(get(4)) || 0);
        if (get(5) != null) setLastDailyClaim(parseInt(get(5)) || 0);
        if (get(6) != null) setPowerPlacerCharges(parseInt(get(6)) || 0);
        if (get(7) != null) setOverdriveCharges(parseInt(get(7)) || 2);
        // Default is unmuted; only honor stored value if explicitly 'true'
      if (get(8) === 'true') setMuted(true);
      else if (get(8) === 'false') setMuted(false);
        if (get(9) != null) { const x = parseInt(get(9)) || 0; setXp(x); xpRef.current = x; }
        if (get(10) != null) setPlayStreak(parseInt(get(10)) || 0);
        if (get(11) != null) setLastPlayDate(parseInt(get(11)) || 0);
        if (get(12) != null) setSnakeCharges(parseInt(get(12)) || 0);
        // Mode progress + bests
        const mp = await window.storage.get('modeProgress').catch(() => null);
        if (mp?.value) { try { setModeProgress({ ...{ goal:1, timed:1, treasure:1 }, ...JSON.parse(mp.value) }); } catch {} }
        const mb = await window.storage.get('modeBests').catch(() => null);
        if (mb?.value) { try { setModeBests({ ...{ endless:0, timed:0, snake:0 }, ...JSON.parse(mb.value) }); } catch {} }
      } catch {}
      setMetaLoaded(true);
    })();
  }, []);

  // Save on change (debounced-ish via simple fire-and-forget)
  useEffect(() => { if (metaLoaded) window.storage.set('coins', String(coins)).catch(() => {}); }, [coins, metaLoaded]);
  useEffect(() => { if (metaLoaded) window.storage.set('best', String(persistedBest)).catch(() => {}); }, [persistedBest, metaLoaded]);
  useEffect(() => { if (metaLoaded) window.storage.set('gamesPlayed', String(gamesPlayed)).catch(() => {}); }, [gamesPlayed, metaLoaded]);
  useEffect(() => { if (metaLoaded) window.storage.set('lifetimeClears', String(lifetimeClears)).catch(() => {}); }, [lifetimeClears, metaLoaded]);
  useEffect(() => { if (metaLoaded) window.storage.set('lifetimeCoins', String(lifetimeCoinsEarned)).catch(() => {}); }, [lifetimeCoinsEarned, metaLoaded]);
  useEffect(() => { if (metaLoaded) window.storage.set('lastDaily', String(lastDailyClaim)).catch(() => {}); }, [lastDailyClaim, metaLoaded]);
  useEffect(() => { if (metaLoaded) window.storage.set('pp', String(powerPlacerCharges)).catch(() => {}); }, [powerPlacerCharges, metaLoaded]);
  useEffect(() => { if (metaLoaded) window.storage.set('od', String(overdriveCharges)).catch(() => {}); }, [overdriveCharges, metaLoaded]);
  useEffect(() => { if (metaLoaded) window.storage.set('muted', muted ? 'true' : 'false').catch(() => {}); }, [muted, metaLoaded]);
  useEffect(() => { if (metaLoaded) window.storage.set('xp', String(xp)).catch(() => {}); }, [xp, metaLoaded]);
  useEffect(() => { if (metaLoaded) window.storage.set('streak', String(playStreak)).catch(() => {}); }, [playStreak, metaLoaded]);
  useEffect(() => { if (metaLoaded) window.storage.set('lastPlay', String(lastPlayDate)).catch(() => {}); }, [lastPlayDate, metaLoaded]);
  useEffect(() => { if (metaLoaded) window.storage.set('snake', String(snakeCharges)).catch(() => {}); }, [snakeCharges, metaLoaded]);
  useEffect(() => { if (metaLoaded) window.storage.set('modeProgress', JSON.stringify(modeProgress)).catch(() => {}); }, [modeProgress, metaLoaded]);
  useEffect(() => { if (metaLoaded) window.storage.set('modeBests', JSON.stringify(modeBests)).catch(() => {}); }, [modeBests, metaLoaded]);

  // Mirror best score up to persistedBest
  useEffect(() => {
    if (best > persistedBest) setPersistedBest(best);
  }, [best, persistedBest]);

  // Award end-of-game coin bonus and bump games played
  useEffect(() => {
    if (gameOver && metaLoaded) {
      const bonus = Math.floor(score / 100);
      if (bonus > 0) earnCoins(bonus);
      setGamesPlayed(g => g + 1);
    }
  }, [gameOver]);

  // Coin economy: earn coins while playing
  const earnCoins = (amount, reason = '', x = null, y = null) => {
    if (amount <= 0) return;
    setCoins(c => c + amount);
    setLifetimeCoinsEarned(v => v + amount);
    setCoinsEarnedThisGame(v => v + amount);
    // Visual: spawn flying coin particles
    if (x !== null && y !== null) {
      const count = Math.min(Math.max(1, Math.ceil(amount / 5)), 6);
      for (let i = 0; i < count; i++) {
        const id = `fc-${Date.now()}-${Math.random()}`;
        const jitter = 40;
        const fx = x + (Math.random() - 0.5) * jitter;
        const fy = y + (Math.random() - 0.5) * jitter;
        const delay = i * 60;
        setTimeout(() => {
          setFlyingCoins(list => [...list, { id, x: fx, y: fy }]);
          setTimeout(() => setFlyingCoins(list => list.filter(c => c.id !== id)), 1000);
        }, delay);
      }
    }
  };

  // XP / Level system
  const XP_PER_LEVEL = 300;
  const levelForXp = (x) => Math.floor(x / XP_PER_LEVEL) + 1;
  const xpIntoLevel = (x) => x % XP_PER_LEVEL;
  const playerLevel = levelForXp(xp);

  const gainXp = (amount) => {
    if (amount <= 0) return;
    setXp(prev => {
      const next = prev + amount;
      const prevLvl = levelForXp(prev);
      const nextLvl = levelForXp(next);
      if (nextLvl > prevLvl) {
        // Level up! Celebrate after a short delay
        setTimeout(() => {
          const bonus = nextLvl * 30;
          triggerCelebration('LEVEL UP', `LEVEL ${nextLvl}`, bonus, 'level');
          setCoins(c => c + bonus);
          setLifetimeCoinsEarned(v => v + bonus);
          setCoinsEarnedThisGame(v => v + bonus);
        }, 400);
      }
      xpRef.current = next;
      return next;
    });
  };

  // Celebration banner trigger
  const celebrationTimeoutRef = useRef(null);
  const triggerCelebration = (title, subtext, bonus, type = 'default') => {
    const id = Date.now() + Math.random();
    setCelebration({ title, subtext, bonus, type, id });
    if (celebrationTimeoutRef.current) clearTimeout(celebrationTimeoutRef.current);
    celebrationTimeoutRef.current = setTimeout(() => {
      setCelebration(c => (c?.id === id ? null : c));
    }, 2400);
    // Play audio sting — different for different types
    if (!mutedRef.current && audioRef.current) {
      try {
        const ctx = audioRef.current;
        if (ctx.state === 'suspended') ctx.resume();
        const sequences = {
          mega:    [523, 659, 784, 1047, 1319, 1568],
          perfect: [523, 659, 784, 1047, 1319, 1568, 2093],
          level:   [392, 494, 587, 784, 988, 1175],
          default: [523, 784, 1047, 1319],
        };
        const notes = sequences[type] || sequences.default;
        notes.forEach((f, i) => setTimeout(() => {
          playTone(f, 0.22, 'triangle', 0.16);
          if (type === 'perfect' || type === 'mega') playTone(f * 2, 0.12, 'sine', 0.08);
        }, i * 55));
      } catch {}
    }
    vibe(type === 'perfect' || type === 'mega' ? [40, 20, 40, 20, 80] : [30, 15, 60]);
  };

  // Play streak check — call once per session on game start
  const checkPlayStreak = () => {
    if (streakCheckedRef.current || !metaLoaded) return;
    streakCheckedRef.current = true;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const today = d.getTime();
    if (lastPlayDate === today) return; // already counted today
    const yesterday = today - 86400000;
    let newStreak = 1;
    if (lastPlayDate === yesterday) {
      newStreak = playStreak + 1;
      setPlayStreak(newStreak);
    } else {
      setPlayStreak(1);
    }
    setLastPlayDate(today);
    const MILESTONES = { 3: 30, 7: 100, 14: 250, 30: 500, 60: 1000, 100: 2000 };
    if (MILESTONES[newStreak]) {
      setTimeout(() => {
        const bonus = MILESTONES[newStreak];
        triggerCelebration(`${newStreak}-DAY STREAK`, 'ON FIRE', bonus, 'level');
        setCoins(c => c + bonus);
        setLifetimeCoinsEarned(v => v + bonus);
      }, 800);
    }
  };

  const DAY_MS = 86400000;
  const canClaimDaily = Date.now() - lastDailyClaim >= DAY_MS;
  const DAILY_BONUS = 50;
  const claimDaily = () => {
    if (!canClaimDaily) return;
    setCoins(c => c + DAILY_BONUS);
    setLifetimeCoinsEarned(v => v + DAILY_BONUS);
    setLastDailyClaim(Date.now());
    if (!mutedRef.current && audioRef.current) {
      try {
        const notes = [523, 659, 784, 1047];
        notes.forEach((f, i) => setTimeout(() => playTone(f, 0.18, 'triangle', 0.15), i * 80));
      } catch {}
    }
  };

  // Shop items
  const SHOP = [
    { id: 'pp', label: 'POWER PLACER', glyph: '💥', price: 25, desc: 'Flood-clears connected blocks',
      buy: () => setPowerPlacerCharges(c => c + 1) },
    { id: 'snake', label: 'SNAKE', glyph: '🐍', price: 80, desc: 'Control a snake that eats blocks',
      buy: () => setSnakeCharges(c => c + 1) },
    { id: 'od', label: 'OVERDRIVE', glyph: '⚡', price: 120, desc: '10s of auto-optimal placement',
      buy: () => setOverdriveCharges(c => Math.min(OVERDRIVE_MAX, c + 1)) },
  ];

  const buyItem = (item) => {
    if (coins < item.price) return;
    setCoins(c => c - item.price);
    item.buy();
    if (!mutedRef.current && audioRef.current) {
      try {
        playTone(784, 0.1, 'triangle', 0.14);
        setTimeout(() => playTone(1047, 0.14, 'sine', 0.1), 60);
      } catch {}
    }
  };

  // CONTINUE after game-over: spend coins for a free Overdrive to recover
  const CONTINUE_COST = 50;
  const canContinue = !usedContinue && coins >= CONTINUE_COST;
  const continueGame = () => {
    if (!canContinue) return;
    setCoins(c => c - CONTINUE_COST);
    setUsedContinue(true);
    setGameOver(false);
    // Grant 10s of overdrive so they can rescue themselves
    setOverdriveEndsAt(Date.now() + OVERDRIVE_DURATION_MS);
    setNowTick(Date.now());
    if (!mutedRef.current && audioRef.current) {
      try {
        const notes = [261.63, 329.63, 392, 523.25, 659.25];
        for (let i = 0; i < notes.length; i++) {
          setTimeout(() => {
            playTone(notes[i], 0.22, 'triangle', 0.16);
            playTone(notes[i] * 2, 0.12, 'sine', 0.08);
          }, i * 55);
        }
      } catch {}
    }
    vibe([60, 30, 80, 30, 100]);
  };

  const boardRef = useRef(null);
  const audioRef = useRef(null);
  const shakeRef = useRef(null);
  const musicRef = useRef({ timer: null, step: 0 });
  const dangerRef = useRef(false);
  const tensionRef = useRef(0);
  const mutedRef = useRef(false);

  const level = Math.floor(score / 1000) + 1;
  const levelProgress = (score % 1000) / 1000;
  const multiplier = getMultiplier(streak);

  useEffect(() => {
    const measure = () => {
      if (boardRef.current) setBoardCell(boardRef.current.getBoundingClientRect().width / GRID);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Keep boardStateRef in sync with board so refs-closed-over code
  // (e.g. the snake tick interval) always reads the latest cells.
  useEffect(() => { boardStateRef.current = board; }, [board]);

  useEffect(() => {
    if (displayScore === score) return;
    const diff = score - displayScore;
    const step = Math.max(1, Math.ceil(Math.abs(diff) / 12));
    const t = setTimeout(() => {
      setDisplayScore(s => {
        const n = s + (diff > 0 ? step : -step);
        if ((diff > 0 && n > score) || (diff < 0 && n < score)) return score;
        return n;
      });
    }, 16);
    return () => clearTimeout(t);
  }, [score, displayScore]);

  const triggerShake = (lvl) => {
    setShakeLevel(lvl);
    setShakeKey(k => k + 1);
  };

  useEffect(() => {
    if (shakeKey === 0 || !shakeRef.current) return;
    const el = shakeRef.current;
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = `shake${shakeLevel} ${380 + shakeLevel * 40}ms cubic-bezier(.36,.07,.19,.97) both`;
  }, [shakeKey, shakeLevel]);

  const initAudio = () => {
    try {
      if (!audioRef.current) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioRef.current = new AC();
      }
      // iOS/Safari starts contexts suspended — must resume from a user gesture
      if (audioRef.current && audioRef.current.state === 'suspended') {
        audioRef.current.resume();
      }
    } catch {}
  };

  const playTone = (freq, duration, type = 'sine', gain = 0.18) => {
    if (muted || !audioRef.current) return;
    try {
      const ctx = audioRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.005);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration + 0.02);
    } catch {}
  };

  const playSweep = (from, to, duration, type = 'sawtooth', gain = 0.15) => {
    if (muted || !audioRef.current) return;
    try {
      const ctx = audioRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(from, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + duration);
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration + 0.05);
    } catch {}
  };

  const vibe = (pattern) => { try { navigator.vibrate?.(pattern); } catch {} };

  // Reusable noise buffer for crunch texture and percussion
  const noiseBufferRef = useRef(null);
  const getNoiseBuffer = () => {
    if (!audioRef.current) return null;
    if (noiseBufferRef.current) return noiseBufferRef.current;
    const ctx = audioRef.current;
    const size = Math.floor(ctx.sampleRate * 0.3);
    const buffer = ctx.createBuffer(1, size, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
    noiseBufferRef.current = buffer;
    return buffer;
  };

  // Deep, beefy "crunch" — 4 layers: sub-bass thump, body tone, swept bandpass noise, hi-pass click
  const playCrunch = (variant = 'place') => {
    if (mutedRef.current || !audioRef.current) return;
    try {
      const ctx = audioRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime;
      const P = variant === 'place'
        ? { subF: 85, subG: 0.28, subD: 0.14, bodyF: [230, 50], bodyG: 0.42, bodyD: 0.16, crunchF: [900, 220], crunchG: 0.32, crunchD: 0.11, clickF: 4500, clickG: 0.18, clickD: 0.015 }
        : variant === 'break'
        ? { subF: 115, subG: 0.24, subD: 0.18, bodyF: [340, 95], bodyG: 0.38, bodyD: 0.2,  crunchF: [1900, 480], crunchG: 0.4,  crunchD: 0.17, clickF: 6500, clickG: 0.22, clickD: 0.014 }
        : { subF: 140, subG: 0.34, subD: 0.25, bodyF: [420, 110], bodyG: 0.48, bodyD: 0.28, crunchF: [2600, 780], crunchG: 0.44, crunchD: 0.22, clickF: 7500, clickG: 0.28, clickD: 0.018 };

      // 1. Sub-bass thump
      const sub = ctx.createOscillator();
      const subG = ctx.createGain();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(P.subF, t);
      sub.frequency.exponentialRampToValueAtTime(28, t + P.subD * 0.85);
      subG.gain.setValueAtTime(0, t);
      subG.gain.linearRampToValueAtTime(P.subG, t + 0.004);
      subG.gain.exponentialRampToValueAtTime(0.001, t + P.subD);
      sub.connect(subG); subG.connect(ctx.destination);
      sub.start(t); sub.stop(t + P.subD + 0.05);

      // 2. Body tone with pitch drop
      const body = ctx.createOscillator();
      const bodyG = ctx.createGain();
      body.type = 'sine';
      body.frequency.setValueAtTime(P.bodyF[0], t);
      body.frequency.exponentialRampToValueAtTime(P.bodyF[1], t + P.bodyD * 0.7);
      bodyG.gain.setValueAtTime(0, t);
      bodyG.gain.linearRampToValueAtTime(P.bodyG, t + 0.005);
      bodyG.gain.exponentialRampToValueAtTime(0.001, t + P.bodyD);
      body.connect(bodyG); bodyG.connect(ctx.destination);
      body.start(t); body.stop(t + P.bodyD + 0.05);

      const buffer = getNoiseBuffer();

      // 3. Swept bandpass noise (the main "crunch")
      if (buffer) {
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.Q.value = 3.5;
        filter.frequency.setValueAtTime(P.crunchF[0], t);
        filter.frequency.exponentialRampToValueAtTime(P.crunchF[1], t + P.crunchD);
        const nG = ctx.createGain();
        nG.gain.setValueAtTime(0, t);
        nG.gain.linearRampToValueAtTime(P.crunchG, t + 0.003);
        nG.gain.exponentialRampToValueAtTime(0.001, t + P.crunchD);
        noise.connect(filter); filter.connect(nG); nG.connect(ctx.destination);
        noise.start(t); noise.stop(t + P.crunchD + 0.02);
      }

      // 4. Sharp high-pass click transient (the "snap" at the very start)
      if (buffer) {
        const click = ctx.createBufferSource();
        click.buffer = buffer;
        const cFilter = ctx.createBiquadFilter();
        cFilter.type = 'highpass';
        cFilter.frequency.value = P.clickF;
        const cG = ctx.createGain();
        cG.gain.setValueAtTime(P.clickG, t);
        cG.gain.exponentialRampToValueAtTime(0.001, t + P.clickD);
        click.connect(cFilter); cFilter.connect(cG); cG.connect(ctx.destination);
        click.start(t); click.stop(t + P.clickD + 0.01);
      }
    } catch {}
  };

  // Short high-pass noise click used as percussion at high tension
  const playPercClick = () => {
    if (mutedRef.current || !audioRef.current) return;
    const buffer = getNoiseBuffer();
    if (!buffer) return;
    try {
      const ctx = audioRef.current;
      const t = ctx.currentTime;
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 2800;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.08, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      noise.connect(filter);
      filter.connect(g);
      g.connect(ctx.destination);
      noise.start(t);
      noise.stop(t + 0.06);
    } catch {}
  };

  // Powerup activation sounds
  const playPowerupSound = (type) => {
    if (mutedRef.current || !audioRef.current) return;
    try {
      if (type === 'BLAST') {
        playCrunch('blast');
        setTimeout(() => playTone(140, 0.35, 'sawtooth', 0.16), 20);
      } else if (type === 'SHUFFLE') {
        playSweep(220, 900, 0.28, 'triangle', 0.13);
        setTimeout(() => playSweep(900, 220, 0.28, 'triangle', 0.09), 120);
      } else if (type === 'GRAVITY') {
        playSweep(700, 110, 0.5, 'sawtooth', 0.12);
        setTimeout(() => playTone(220, 0.3, 'sine', 0.16), 120);
      } else if (type.startsWith('MULT')) {
        const notes = [523, 659, 784, 988, 1175];
        for (let i = 0; i < notes.length; i++) {
          setTimeout(() => playTone(notes[i], 0.14, 'triangle', 0.12), i * 45);
        }
      }
    } catch {}
  };

  // ---- Background music ----
  const playMusicNote = (freq, duration, type, gain) => {
    if (mutedRef.current || !audioRef.current) return;
    try {
      const ctx = audioRef.current;
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0, ctx.currentTime);
      g.gain.linearRampToValueAtTime(gain, ctx.currentTime + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration + 0.05);
    } catch {}
  };

  const musicStep = () => {
    if (mutedRef.current || !audioRef.current) return;
    const step = musicRef.current.step;
    const chordIdx = Math.floor(step / 8) % 4;
    const noteIdx = step % 8;
    const chord = MUSIC_CHORDS[chordIdx];
    const T = tensionRef.current; // 0 peaceful → 1 urgent

    // Oscillator types and levels evolve smoothly with tension
    const bassType = T < 0.55 ? 'triangle' : 'sawtooth';
    const arpType  = T < 0.35 ? 'sine' : T < 0.7 ? 'triangle' : 'sawtooth';
    const baseGain = 0.04 + T * 0.045;

    // Bass on beats 1 and 3
    if (noteIdx === 0 || noteIdx === 4) {
      playMusicNote(chord.bass, 0.95, bassType, baseGain * 1.7);
    }
    // Arpeggio every step
    playMusicNote(chord.arp[noteIdx], 0.32, arpType, baseGain);

    // Mid-tension: sustained pad note layered underneath
    if (T > 0.35 && noteIdx === 0) {
      playMusicNote(chord.arp[0] * 0.5, 1.4, 'triangle', baseGain * 0.55);
    }
    // Higher tension: dissonant tritone stab
    if (T > 0.62 && noteIdx % 4 === 2) {
      playMusicNote(chord.bass * 1.414, 0.18, 'square', 0.03 + T * 0.02);
    }
    // Urgent: percussion clicks on off-beats
    if (T > 0.78 && (noteIdx === 2 || noteIdx === 6)) {
      playPercClick();
    }

    musicRef.current.step = (step + 1) % 32;
  };

  const scheduleMusic = () => {
    // Step time interpolates from 300ms (peaceful) to 160ms (urgent)
    const stepMs = Math.round(300 - tensionRef.current * 140);
    musicRef.current.timer = setTimeout(() => {
      musicStep();
      if (musicRef.current.timer !== null) scheduleMusic();
    }, stepMs);
  };

  const startMusic = () => {
    if (musicRef.current.timer) return;
    musicRef.current.step = 0;
    musicRef.current.timer = 1; // non-null sentinel so scheduleMusic proceeds
    scheduleMusic();
  };

  const stopMusic = () => {
    if (musicRef.current.timer) {
      clearTimeout(musicRef.current.timer);
      musicRef.current.timer = null;
    }
  };

  // Keep muted ref synced for use inside the music scheduler (danger ref is synced further below)
  useEffect(() => { mutedRef.current = muted; }, [muted]);

  const reset = () => {
    setBoard(emptyBoard());
    setTray(newTray(level));
    setTrayKey(k => k + 1);
    setScore(0);
    setDisplayScore(0);
    setStreak(0);
    setClearCount(0);
    setClearing({ rows: [], cols: [] });
    setGameOver(false);
    setPaused(false);
    pausedRef.current = false;
    pauseStartRef.current = 0;
    // Reset timed-mode clock. Other modes ignore this value.
    {
      const start = modeRef.current === 'timed' ? TIMED_START : 0;
      setTimeRemaining(start);
      timeRemainingRef.current = start;
    }
    setToast(null);
    setPopups([]);
    setParticles([]);
    setFreshCells(new Set());
    setOverdriveEndsAt(null);
    setPowerPlacerPending(false);
    setCoinsEarnedThisGame(0);
    setUsedContinue(false);
    setMilestonesHit([]);
    setCelebration(null);
    // Snake state
    setSnakeActive(false);
    snakeActiveRef.current = false;
    setSnakeBody([]);
    snakeBodyRef.current = [];
    setSnakeEaten(0);
    snakeEatenRef.current = 0;
    setSnakeScore(0);
    snakeScoreRef.current = 0;
    snakeQueuedRef.current = null;
  };

  const addPopup = (value, mul, lines, pwrMult) => {
    const id = rand();
    const color = pwrMult ? '#ffd60a' : lines >= 3 ? '#a855f7' : lines >= 2 ? '#ff2e6e' : '#ffd60a';
    setPopups(p => [...p, { id, value, color, mul: mul > 1 ? mul : null, pwrMult: pwrMult || null }]);
    setTimeout(() => setPopups(p => p.filter(x => x.id !== id)), 1100);
  };

  const addParticles = (cells, boardRect) => {
    const cs = boardRect.width / GRID;
    const newP = [];
    for (const { r, c, color } of cells) {
      const cx = boardRect.left + c * cs + cs / 2;
      const cy = boardRect.top + r * cs + cs / 2;
      const count = 7;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + Math.random() * 0.8;
        const speed = 70 + Math.random() * 120;
        newP.push({
          id: rand() + '-' + i,
          x: cx,
          y: cy,
          dx: Math.cos(angle) * speed,
          dy: Math.sin(angle) * speed - 50,
          color: color.main,
          size: 4 + Math.random() * 5,
          rot: Math.random() * 360,
        });
      }
    }
    setParticles(p => [...p, ...newP]);
    setTimeout(() => {
      const ids = new Set(newP.map(x => x.id));
      setParticles(p => p.filter(x => !ids.has(x.id)));
    }, 900);
  };

  const canPlace = useCallback((piece, row, col, brd) => {
    for (const [dr, dc] of piece.cells) {
      const r = row + dr, c = col + dc;
      if (r < 0 || r >= GRID || c < 0 || c >= GRID) return false;
      if (brd[r][c]) return false;
    }
    return true;
  }, []);

  const canFit = useCallback((piece, brd) => {
    for (let r = 0; r < GRID; r++)
      for (let c = 0; c < GRID; c++)
        if (canPlace(piece, r, c, brd)) return true;
    return false;
  }, [canPlace]);

  // ---- OVERDRIVE: limited-quantity on-demand powerup ----
  const OVERDRIVE_DURATION_MS = 10000;
  const OVERDRIVE_MAX = 3;

  const overdriveActive = overdriveEndsAt !== null && nowTick < overdriveEndsAt;
  const overdriveRemaining = overdriveActive
    ? Math.max(0, (overdriveEndsAt - nowTick) / 1000)
    : 0;

  // Tick during overdrive for countdown display
  useEffect(() => {
    if (!overdriveEndsAt) return;
    const id = setInterval(() => {
      if (pausedRef.current) return;
      const t = Date.now();
      setNowTick(t);
      if (t >= overdriveEndsAt) {
        setOverdriveEndsAt(null);
        // End-of-overdrive sound: soft falling sweep
        if (!mutedRef.current && audioRef.current) {
          try {
            const ctx = audioRef.current;
            const tt = ctx.currentTime;
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(880, tt);
            osc.frequency.exponentialRampToValueAtTime(220, tt + 0.45);
            g.gain.setValueAtTime(0.08, tt);
            g.gain.exponentialRampToValueAtTime(0.001, tt + 0.45);
            osc.connect(g); g.connect(ctx.destination);
            osc.start(tt); osc.stop(tt + 0.5);
          } catch {}
        }
        // Game-over check deferred — if board is now unwinnable, end the game
        setTimeout(() => {
          if (snakeActiveRef.current) return;
          setTray(curTray => {
            setBoard(curBoard => {
              if (!curTray.filter(Boolean).some(p => canFit(p, curBoard))) {
                setGameOver(true);
              }
              return curBoard;
            });
            return curTray;
          });
        }, 150);
      }
    }, 50);
    return () => clearInterval(id);
  }, [overdriveEndsAt, canFit]);

  // Score a candidate placement for the optimal-placement autopilot
  const scorePlacement = (piece, row, col, brd) => {
    const sim = brd.map(r => [...r]);
    for (const [dr, dc] of piece.cells) sim[row + dr][col + dc] = piece.color;
    let lines = 0;
    for (let r = 0; r < GRID; r++) if (sim[r].every(x => x)) lines++;
    for (let c = 0; c < GRID; c++) if (sim.every(rr => rr[c])) lines++;
    // Post-clear emptiness (future freedom)
    const post = sim.map(r => [...r]);
    for (let r = 0; r < GRID; r++) if (post[r].every(x => x)) for (let c = 0; c < GRID; c++) post[r][c] = null;
    for (let c = 0; c < GRID; c++) if (post.every(rr => rr[c])) for (let r = 0; r < GRID; r++) post[r][c] = null;
    let empty = 0;
    for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) if (!post[r][c]) empty++;
    // Compactness (adjacent existing blocks)
    let adj = 0;
    for (const [dr, dc] of piece.cells) {
      const r = row + dr, c = col + dc;
      for (const [ar, ac] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nr = r + ar, nc = c + ac;
        if (nr < 0 || nr >= GRID || nc < 0 || nc >= GRID) { adj++; continue; } // edges count
        if (brd[nr][nc]) adj++;
      }
    }
    return lines * 1000 + empty * 6 + adj * 2;
  };

  const findBestPlacement = (piece, brd) => {
    let best = null, bestScore = -Infinity;
    for (let r = 0; r < GRID; r++) {
      for (let c = 0; c < GRID; c++) {
        if (!canPlace(piece, r, c, brd)) continue;
        const s = scorePlacement(piece, r, c, brd);
        if (s > bestScore) { bestScore = s; best = { row: r, col: c }; }
      }
    }
    return best;
  };

  // OVERDRIVE MORPHING: given N cells needed and a cursor position, pick the
  // N best empty cells — the piece's shape morphs to fit around existing blocks.
  // Greedy: each step picks the empty cell that most improves score (line
  // completion + fullness of row/col + proximity to cursor).
  const morphedPlacement = (N, brd, cursorR, cursorC) => {
    // Count total empties up front
    let totalEmpty = 0;
    for (let r = 0; r < GRID; r++)
      for (let c = 0; c < GRID; c++)
        if (!brd[r][c]) totalEmpty++;
    if (totalEmpty < N) return null;

    const sim = brd.map(row => row.map(x => x ? x : null));
    const placed = [];
    const MARKER = '__MORPH__';

    for (let step = 0; step < N; step++) {
      let best = null, bestScore = -Infinity;
      for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
          if (sim[r][c]) continue;
          // Tentatively place
          sim[r][c] = MARKER;
          let score = 0;
          if (sim[r].every(x => x)) score += 1500; // completes the row
          if (sim.every(rr => rr[c])) score += 1500; // completes the column
          // Reward cells whose row/col is close to full
          let rowE = 0, colE = 0;
          for (let i = 0; i < GRID; i++) {
            if (!sim[r][i]) rowE++;
            if (!sim[i][c]) colE++;
          }
          score += (GRID - rowE) * 6 + (GRID - colE) * 6;
          // Proximity to cursor so the shape forms near the finger
          const d = Math.sqrt((r - cursorR) ** 2 + (c - cursorC) ** 2);
          score -= d * 4;
          // Mild preference for cells adjacent to existing real blocks (not our markers)
          for (const [ar, ac] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            const nr = r + ar, nc = c + ac;
            if (nr < 0 || nr >= GRID || nc < 0 || nc >= GRID) { score += 1; continue; }
            if (sim[nr][nc] && sim[nr][nc] !== MARKER) score += 3;
          }
          sim[r][c] = null;
          if (score > bestScore) { bestScore = score; best = [r, c]; }
        }
      }
      if (!best) return null;
      sim[best[0]][best[1]] = MARKER;
      placed.push(best);
    }
    return placed;
  };

  const activateOverdrive = () => {
    if (overdriveCharges <= 0 || overdriveActive || gameOver) return;
    initAudio();
    setOverdriveCharges(c => c - 1);
    setOverdriveEndsAt(Date.now() + OVERDRIVE_DURATION_MS);
    setNowTick(Date.now());
    vibe([60, 30, 60, 30, 80]);
    // Activation fanfare: ascending arpeggio + held chord
    if (!mutedRef.current && audioRef.current) {
      try {
        const notes = [261.63, 329.63, 392, 523.25, 659.25];
        for (let i = 0; i < notes.length; i++) {
          setTimeout(() => {
            playTone(notes[i], 0.22, 'triangle', 0.16);
            playTone(notes[i] * 2, 0.12, 'sine', 0.08);
          }, i * 55);
        }
        setTimeout(() => {
          playTone(523.25, 1.2, 'triangle', 0.08);
          playTone(659.25, 1.2, 'triangle', 0.06);
          playTone(783.99, 1.2, 'triangle', 0.05);
        }, 320);
      } catch {}
    }
  };

  const activatePowerPlacer = () => {
    if (powerPlacerCharges <= 0 || powerPlacerPending || gameOver) return;
    initAudio();
    setPowerPlacerCharges(c => c - 1);
    setPowerPlacerPending(true);
    setToast('POWER PLACER ARMED');
    setTimeout(() => setToast(null), 1100);
    vibe([40, 20, 60]);
    // Short "armed" cue: two descending tones with gritty noise
    if (!mutedRef.current && audioRef.current) {
      try {
        playTone(880, 0.08, 'square', 0.12);
        setTimeout(() => playTone(660, 0.12, 'sawtooth', 0.14), 60);
        setTimeout(() => playCrunch('place'), 120);
      } catch {}
    }
  };

  // ---------- SNAKE: retro snake minigame powerup ----------
  const SNAKE_TICK_MS = 320;
  const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
  const DIR_DELTA = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };

  const activateSnake = () => {
    if (snakeCharges <= 0 || snakeActive || gameOver || overdriveActive || powerPlacerPending) return;
    // Need at least one block to be worth eating
    const hasBlocks = board.some(row => row.some(cell => !!cell));
    if (!hasBlocks) {
      setToast('NO BLOCKS TO EAT');
      setTimeout(() => setToast(null), 1400);
      if (!mutedRef.current && audioRef.current) {
        try { playTone(220, 0.16, 'sawtooth', 0.1); } catch {}
      }
      return;
    }
    initAudio();
    setSnakeCharges(c => c - 1);

    // Find a good starting row: one with the most empty cells
    let bestRow = 3, bestEmpty = -1;
    for (let r = 0; r < GRID; r++) {
      const e = board[r].filter(c => !c).length;
      if (e > bestEmpty) { bestEmpty = e; bestRow = r; }
    }
    // Find 3 consecutive empty columns in that row; fall back to cols 2-4
    let startC = 2;
    for (let c = 0; c <= GRID - 3; c++) {
      if (!board[bestRow][c] && !board[bestRow][c+1] && !board[bestRow][c+2]) {
        startC = c;
        break;
      }
    }
    const body = [
      { r: bestRow, c: startC + 2 }, // head
      { r: bestRow, c: startC + 1 },
      { r: bestRow, c: startC },      // tail
    ];
    // If any starting cell had a block, clear it (freebie eat)
    setBoard(b => {
      const nb = b.map(row => [...row]);
      let freebies = 0;
      for (const seg of body) {
        if (nb[seg.r][seg.c]) { nb[seg.r][seg.c] = null; freebies++; }
      }
      if (freebies > 0) {
        snakeEatenRef.current = freebies;
        setSnakeEaten(freebies);
        snakeScoreRef.current = freebies * 10;
        setSnakeScore(freebies * 10);
      }
      return nb;
    });
    snakeBodyRef.current = body;
    setSnakeBody(body);
    snakeDirRef.current = 'right';
    setSnakeDir('right');
    snakeQueuedRef.current = null;
    snakeActiveRef.current = true;
    setSnakeActive(true);

    setToast('SWIPE / ARROWS TO STEER');
    setTimeout(() => setToast(null), 1800);

    // Fanfare — snake-charmer motif
    if (!mutedRef.current && audioRef.current) {
      try {
        const ctx = audioRef.current;
        if (ctx.state === 'suspended') ctx.resume();
        [392, 466, 523, 659, 784].forEach((f, i) => setTimeout(() => {
          playTone(f, 0.22, 'sawtooth', 0.14);
          playTone(f * 0.5, 0.18, 'sine', 0.08);
        }, i * 70));
      } catch {}
    }
    vibe([40, 20, 40, 20, 80]);
  };

  const endSnake = (perfectClear = false) => {
    snakeActiveRef.current = false;
    setSnakeActive(false);
    const eaten = snakeEatenRef.current;
    const snakeScore = snakeScoreRef.current;

    // Transfer snake score to main score
    if (snakeScore > 0) {
      setScore(s => {
        const ns = s + snakeScore;
        setBest(b => Math.max(b, ns));
        return ns;
      });
    }
    // Reward coins and celebrate based on how many blocks eaten
    const coinReward = Math.max(0, eaten * 3);
    const rect = boardRef.current?.getBoundingClientRect();
    const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;

    if (perfectClear) {
      const bonus = 300 + eaten * 3;
      triggerCelebration('PERFECT!', `SNAKE CLEARED BOARD · ${eaten}`, bonus, 'perfect');
      earnCoins(bonus, '', cx, cy);
    } else if (eaten >= 20) {
      triggerCelebration('SNAKE MASTER', `ATE ${eaten} BLOCKS`, coinReward + 50, 'mega');
      earnCoins(coinReward + 50, '', cx, cy);
    } else if (eaten >= 10) {
      triggerCelebration('SNAKE!', `ATE ${eaten} BLOCKS`, coinReward + 15, 'level');
      earnCoins(coinReward + 15, '', cx, cy);
    } else if (eaten > 0) {
      triggerCelebration('SNAKE DONE', `ATE ${eaten}`, coinReward);
      earnCoins(coinReward, '', cx, cy);
    }

    // Audio: ascending triumphant fanfare on perfect, descending sawtooth on tail-bite
    if (!mutedRef.current && audioRef.current) {
      try {
        if (perfectClear) {
          const notes = [392, 523, 659, 784, 988, 1175, 1568];
          notes.forEach((f, i) => setTimeout(() => {
            playTone(f, 0.22, 'triangle', 0.16);
            playTone(f * 2, 0.12, 'sine', 0.08);
          }, i * 70));
        } else {
          [784, 659, 523, 392].forEach((f, i) => setTimeout(() => playTone(f, 0.18, 'sawtooth', 0.12), i * 80));
        }
      } catch {}
    }
    vibe(perfectClear ? [40, 20, 40, 20, 80, 40, 160] : [60, 30, 100]);

    // Clear snake state after a beat
    setTimeout(() => {
      setSnakeBody([]);
      snakeBodyRef.current = [];
      setSnakeEaten(0);
      snakeEatenRef.current = 0;
      setSnakeScore(0);
      snakeScoreRef.current = 0;
      snakeQueuedRef.current = null;
    }, 800);
  };

  const snakeTick = () => {
    if (!snakeActiveRef.current) return;
    if (pausedRef.current) return;

    // End immediately if the board is already empty (covers activation's
    // starting-cell freebies clearing the last blocks, or any other route
    // to an empty grid during snake mode).
    {
      const lb = boardStateRef.current;
      if (lb) {
        let anyLeft = false;
        for (let r = 0; r < GRID && !anyLeft; r++) {
          for (let c = 0; c < GRID; c++) {
            if (lb[r][c]) { anyLeft = true; break; }
          }
        }
        if (!anyLeft) {
          endSnake(true);
          return;
        }
      }
    }

    // Resolve direction (queued if not directly opposite)
    const currentDir = snakeDirRef.current;
    const queued = snakeQueuedRef.current;
    let newDir = currentDir;
    if (queued && queued !== OPPOSITE[currentDir]) newDir = queued;
    snakeDirRef.current = newDir;
    snakeQueuedRef.current = null;
    setSnakeDir(newDir);

    const body = snakeBodyRef.current;
    if (!body.length) return;
    const head = body[0];
    const [dr, dc] = DIR_DELTA[newDir];
    let nr = head.r + dr, nc = head.c + dc;
    // Wrap around edges (more forgiving and more fun)
    if (nr < 0) nr = GRID - 1;
    if (nr >= GRID) nr = 0;
    if (nc < 0) nc = GRID - 1;
    if (nc >= GRID) nc = 0;

    // Always read the freshest board. The snake interval's closure captures
    // `board` at activation; using the ref avoids stale cells that would
    // phantom-grow the snake on already-eaten squares.
    const liveBoard = boardStateRef.current || board;
    const willEat = !!liveBoard[nr][nc];
    // If eating, tail stays → head may collide with tail; if not eating, tail moves → exclude tail from check
    const collideList = willEat ? body : body.slice(0, -1);
    const bit = collideList.some(s => s.r === nr && s.c === nc);
    if (bit) {
      // Head ate its own body — snake ends
      endSnake();
      return;
    }

    // Move: prepend new head
    const newBody = [{ r: nr, c: nc }, ...body];
    if (!willEat) newBody.pop();

    if (willEat) {
      // Eat the block and — using the fresh post-eat board — detect a perfect
      // clear. The `board` closure is stale because the snake interval is
      // created once per session, so we must read authoritative state inside
      // the functional updater.
      let clearedBoard = false;
      setBoard(b => {
        const nb = b.map(row => [...row]);
        nb[nr][nc] = null;
        let anyRemaining = false;
        for (let r = 0; r < GRID && !anyRemaining; r++) {
          for (let c = 0; c < GRID; c++) {
            if (nb[r][c]) { anyRemaining = true; break; }
          }
        }
        clearedBoard = !anyRemaining;
        return nb;
      });
      snakeEatenRef.current += 1;
      setSnakeEaten(e => e + 1);
      snakeScoreRef.current += 10;
      setSnakeScore(s => s + 10);
      // Timed mode: eating a block banks a second onto the clock.
      addTime(TIMED_PER_SNAKE_EAT);
      // Coin drop at eaten cell
      const rect = boardRef.current?.getBoundingClientRect();
      if (rect && boardCell) {
        const x = rect.left + 6 + nc * (rect.width - 12) / GRID + (rect.width - 12) / GRID / 2;
        const y = rect.top + 6 + nr * (rect.height - 12) / GRID + (rect.height - 12) / GRID / 2;
        earnCoins(1, '', x, y);
      } else {
        earnCoins(1);
      }
      if (!mutedRef.current && audioRef.current) {
        try {
          playTone(660 + Math.min(snakeEatenRef.current * 20, 600), 0.06, 'square', 0.12);
        } catch {}
      }
      vibe(10);

      if (clearedBoard) {
        // Commit the final body move so the last eat animates before celebration
        snakeBodyRef.current = newBody;
        setSnakeBody(newBody);
        setTimeout(() => {
          if (snakeActiveRef.current) endSnake(true);
        }, 450);
        return;
      }
    } else {
      // Soft tick sound
      if (!mutedRef.current && audioRef.current) {
        try {
          playTone(220, 0.03, 'sine', 0.04);
        } catch {}
      }
    }

    snakeBodyRef.current = newBody;
    setSnakeBody(newBody);
  };

  // Snake tick interval
  useEffect(() => {
    if (!snakeActive) return;
    const id = setInterval(snakeTick, SNAKE_TICK_MS);
    return () => clearInterval(id);
  }, [snakeActive]);

  // Add time to the timed-mode clock, capped at TIMED_MAX. No-op in other modes.
  const addTime = (seconds) => {
    if (modeRef.current !== 'timed' || !seconds) return;
    setTimeRemaining(prev => {
      const next = Math.min(TIMED_MAX, prev + seconds);
      timeRemainingRef.current = next;
      return next;
    });
  };

  // Timed-mode countdown. Ticks every 100 ms for smooth display. The timer
  // freezes while overdrive or snake is active so the player can't lose
  // while a powerup is running, per design.
  useEffect(() => {
    if (mode !== 'timed' || gameOver) return;
    const tickMs = 100;
    const id = setInterval(() => {
      if (overdriveActive || snakeActiveRef.current || pausedRef.current) return;
      setTimeRemaining(prev => {
        const next = Math.max(0, prev - tickMs / 1000);
        timeRemainingRef.current = next;
        if (next === 0 && !gameOver) {
          // Schedule the game-over flip outside this setter to avoid nested
          // state updates inside setTimeRemaining.
          setTimeout(() => {
            if (modeRef.current === 'timed' && timeRemainingRef.current === 0) {
              setGameOver(true);
              if (!mutedRef.current && audioRef.current) {
                try { playSweep(440, 110, 0.6, 'sawtooth', 0.18); } catch {}
              }
              vibe([80, 40, 160]);
            }
          }, 0);
        }
        return next;
      });
    }, tickMs);
    return () => clearInterval(id);
  }, [mode, gameOver, overdriveActive]);

  // Snake swipe handlers (attached to board container while active)
  const snakeSwipe = {
    onPointerDown: (e) => {
      if (!snakeActiveRef.current) return;
      snakeSwipeStartRef.current = { x: e.clientX, y: e.clientY };
    },
    onPointerMove: (e) => {
      if (!snakeActiveRef.current) return;
      const start = snakeSwipeStartRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      const absX = Math.abs(dx), absY = Math.abs(dy);
      if (Math.max(absX, absY) < 22) return;
      const dir = absX > absY ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      if (dir !== OPPOSITE[snakeDirRef.current]) {
        snakeQueuedRef.current = dir;
      }
      snakeSwipeStartRef.current = { x: e.clientX, y: e.clientY };
    },
    onPointerUp: () => { snakeSwipeStartRef.current = null; },
    onPointerCancel: () => { snakeSwipeStartRef.current = null; },
  };

  // Snake keyboard controls (desktop)
  useEffect(() => {
    if (!snakeActive) return;
    const KEY_DIR = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      w: 'up', W: 'up', s: 'down', S: 'down', a: 'left', A: 'left', d: 'right', D: 'right',
    };
    const onKey = (e) => {
      const dir = KEY_DIR[e.key];
      if (!dir) return;
      e.preventDefault();
      if (dir !== OPPOSITE[snakeDirRef.current]) {
        snakeQueuedRef.current = dir;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [snakeActive]);

  // DANGER: at least one placement the player could make right now would leave
  // NO remaining tray piece able to fit anywhere (immediate game over on next placement)
  // Suppressed during overdrive since placement is always possible then.
  const danger = useMemo(() => {
    if (gameOver || overdriveActive) return false;
    // Timed mode: under 10 seconds is a danger state on its own.
    if (mode === 'timed' && timeRemaining > 0 && timeRemaining <= 10) return true;
    const pieces = tray.filter(Boolean);
    if (pieces.length <= 1) return false; // need ≥2 pieces to have "remaining"
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      const others = pieces.filter((_, j) => j !== i);
      for (let r = 0; r < GRID; r++) {
        for (let c = 0; c < GRID; c++) {
          if (!canPlace(piece, r, c, board)) continue;
          // Simulate placement + line clears
          const sim = board.map(row => [...row]);
          for (const [dr, dc] of piece.cells) sim[r + dr][c + dc] = piece.color;
          const rcs = [], ccs = [];
          for (let rr = 0; rr < GRID; rr++) if (sim[rr].every(x => x)) rcs.push(rr);
          for (let cc = 0; cc < GRID; cc++) if (sim.every(rr => rr[cc])) ccs.push(cc);
          for (const rr of rcs) for (let cc = 0; cc < GRID; cc++) sim[rr][cc] = null;
          for (const cc of ccs) for (let rr = 0; rr < GRID; rr++) sim[rr][cc] = null;
          // If NONE of the other pieces can fit after this move, it's a losing move
          if (!others.some(p => canFit(p, sim))) return true;
        }
      }
    }
    return false;
  }, [board, tray, gameOver, overdriveActive, canPlace, canFit, mode, timeRemaining]);

  // Sync danger to a ref so the music scheduler can read the latest value
  useEffect(() => { dangerRef.current = danger; }, [danger]);

  // Continuous tension metric driving music evolution (0 peaceful → 1 urgent)
  const tension = useMemo(() => {
    if (gameOver) return 0;
    let filled = 0;
    for (let r = 0; r < GRID; r++)
      for (let c = 0; c < GRID; c++)
        if (board[r][c]) filled++;
    const fillRatio = filled / (GRID * GRID);
    // Danger adds an extra boost so music pivots hard when a move could lose
    return Math.min(1, fillRatio * 1.15 + (danger ? 0.28 : 0));
  }, [board, danger, gameOver]);

  useEffect(() => { tensionRef.current = tension; }, [tension]);

  // Start/stop music based on mute state and game state
  useEffect(() => {
    if (!muted && !gameOver && audioRef.current) startMusic();
    else stopMusic();
    return () => stopMusic();
  }, [muted, gameOver]);

  // place() now takes an explicit cells array so the same path handles
  // normal shape placements AND overdrive morphed placements.
  const place = (trayIndex, cells) => {
    const piece = tray[trayIndex];
    if (!piece || !cells || cells.length !== piece.cells.length) return;
    // Validate every target cell is in bounds and empty
    for (const [r, c] of cells) {
      if (r < 0 || r >= GRID || c < 0 || c >= GRID) return;
      if (board[r][c]) return;
    }

    // Decide if this placement spawns a powerup on one of its cells
    const spawnPowerup = Math.random() < POWERUP_SPAWN_CHANCE;
    const powerupIdx = spawnPowerup ? Math.floor(Math.random() * cells.length) : -1;
    const chosenPowerup = spawnPowerup ? pickPowerup() : null;

    const next = board.map(r => [...r]);
    const placedKeys = [];
    // Map original-piece-cell index → matching cell in `cells`. For normal
    // placements indexes line up; for overdrive's morphed placements the
    // diamond marker is dropped (only `cells.length` is preserved there).
    const sourceCells = piece.cells.length === cells.length ? piece.cells : null;
    cells.forEach(([r, c], i) => {
      const isDiamondCell = sourceCells && piece.diamondAt === i;
      next[r][c] = {
        color: piece.color,
        powerup: i === powerupIdx ? chosenPowerup : null,
        // hp=2 = pristine diamond, hp=1 = cracked, undefined = normal block.
        diamond: isDiamondCell ? 2 : undefined,
      };
      placedKeys.push(`${r},${c}`);
    });

    // Detect cleared rows/columns
    const rc = [], cc = [];
    for (let r = 0; r < GRID; r++) if (next[r].every(x => x)) rc.push(r);
    for (let c = 0; c < GRID; c++) if (next.every(rr => rr[c])) cc.push(c);

    // Build the mask of cells being cleared
    const clearMask = new Set();
    // Cells that must fully remove regardless of diamond hp (PP flood,
    // BLAST, snake bites, etc — fragile-block bypass).
    const forceClearMask = new Set();
    for (const r of rc) for (let c = 0; c < GRID; c++) clearMask.add(`${r},${c}`);
    for (const c of cc) for (let r = 0; r < GRID; r++) clearMask.add(`${r},${c}`);

    // POWER PLACER: flood-fill from the placed cells through connected blocks
    // and add them all to the clear mask (shape + connected cluster all break).
    // Also forces diamond removal — PP shatters fragile blocks in one hit.
    const triggeredPowerPlacer = powerPlacerPending;
    if (triggeredPowerPlacer) {
      setPowerPlacerPending(false);
      const visited = new Set(cells.map(([r, c]) => `${r},${c}`));
      const queue = [...cells];
      while (queue.length) {
        const [r, c] = queue.shift();
        clearMask.add(`${r},${c}`);
        forceClearMask.add(`${r},${c}`);
        for (const [ar, ac] of [[-1,0],[1,0],[0,-1],[0,1]]) {
          const nr = r + ar, nc = c + ac;
          if (nr < 0 || nr >= GRID || nc < 0 || nc >= GRID) continue;
          const k = `${nr},${nc}`;
          if (visited.has(k) || !next[nr][nc]) continue;
          visited.add(k);
          queue.push([nr, nc]);
        }
      }
    }

    // Find powerups that sit inside the clear mask (they activate)
    const activatedPowerups = [];
    for (const k of clearMask) {
      const [r, c] = k.split(',').map(Number);
      const cell = next[r][c];
      if (cell?.powerup) activatedPowerups.push({ r, c, powerup: cell.powerup });
    }

    const placed = piece.cells.length;
    const lines = rc.length + cc.length;
    const totalCellsCleared = clearMask.size;

    // MULT powerups stack multiplicatively
    let powerupMult = 1;
    for (const ap of activatedPowerups) {
      if (ap.powerup.mult) powerupMult *= ap.powerup.mult;
    }

    // Streak only advances on traditional row/col clears
    const newStreak = lines > 0 ? streak + 1 : 0;
    const streakMult = getMultiplier(newStreak);
    setStreak(newStreak);

    // Timed mode: every placement banks a little time; each cleared line
    // banks a bigger chunk. Capped at TIMED_MAX inside addTime().
    addTime(TIMED_PER_PLACE + lines * TIMED_PER_CLEAR);

    // SCORING
    //   Placement: +1 per block placed
    //   Each cleared cell: +2 (so a full row = 2 × 8 = 16 extra points)
    //   Streak multiplier and powerup multiplier stack on the clear portion
    let pts = placed;
    let clearPts = 0;
    if (totalCellsCleared > 0) {
      const base = totalCellsCleared * 2;
      clearPts = Math.round(base * streakMult * powerupMult);
      pts += clearPts;
      if (lines > 0) {
        setClearCount(c => c + lines);
        setLifetimeClears(v => v + lines);
      }
      // Earn coins: 1 per cleared cell + CASCADE bonus + combo bonus
      const coinReward = Math.ceil(totalCellsCleared / 2)
        + (lines >= 3 ? 10 : 0)
        + (lines >= 2 ? 3 : 0)
        + (triggeredPowerPlacer ? Math.ceil(totalCellsCleared / 3) : 0);
      if (coinReward > 0) {
        const rect = boardRef.current?.getBoundingClientRect();
        const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
        const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
        earnCoins(coinReward, '', cx, cy);
      }

      // MEGA CASCADE: 4+ lines at once
      if (lines >= 4) {
        setTimeout(() => {
          const megaBonus = 50 + lines * 15;
          triggerCelebration('MEGA CASCADE', `${lines} LINES · ×${streakMult}`, megaBonus, 'mega');
          const rect = boardRef.current?.getBoundingClientRect();
          const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
          const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
          earnCoins(megaBonus, '', cx, cy);
        }, 350);
      }

      // PERFECT CLEAR: board becomes fully empty after this clear
      // (next is the board with placed cells; subtract what's being cleared)
      let anyRemaining = false;
      for (let r = 0; r < GRID && !anyRemaining; r++) {
        for (let c = 0; c < GRID; c++) {
          if (next[r][c] && !clearMask.has(`${r},${c}`)) {
            anyRemaining = true;
            break;
          }
        }
      }
      if (!anyRemaining) {
        setTimeout(() => {
          const perfectBonus = 250;
          triggerCelebration('PERFECT!', 'BOARD CLEARED', perfectBonus, 'perfect');
          const rect = boardRef.current?.getBoundingClientRect();
          const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
          const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
          earnCoins(perfectBonus, '', cx, cy);
        }, 650);
      }
    }

    setScore(s => {
      const ns = s + pts;
      setBest(b => Math.max(b, ns));
      if (Math.floor(ns / 1000) > Math.floor(s / 1000)) {
        setTimeout(() => {
          setToast(`LEVEL ${Math.floor(ns / 1000) + 1}`);
          setTimeout(() => setToast(null), 1100);
          playTone(660, 0.15, 'triangle', 0.22);
          setTimeout(() => playTone(880, 0.2, 'sine', 0.2), 80);
        }, 150);
      }
      // Earn overdrive charge every 1500 points
      const oldThr = Math.floor(s / 1500);
      const newThr = Math.floor(ns / 1500);
      if (newThr > oldThr) {
        setOverdriveCharges(c => Math.min(OVERDRIVE_MAX, c + (newThr - oldThr)));
      }
      // Gain XP = 1 per 5 points of score
      const xpGain = Math.floor(ns / 5) - Math.floor(s / 5);
      if (xpGain > 0) gainXp(xpGain);
      // Score milestone celebrations
      const MILESTONES = [1000, 2500, 5000, 10000, 25000, 50000, 100000];
      for (const m of MILESTONES) {
        if (ns >= m && s < m) {
          setTimeout(() => {
            const bonus = 20 + Math.floor(m / 1000) * 5;
            triggerCelebration(`${m.toLocaleString()} POINTS`, 'MILESTONE', bonus);
            const rect = boardRef.current?.getBoundingClientRect();
            const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
            const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
            earnCoins(bonus, '', cx, cy);
          }, 800);
        }
      }
      return ns;
    });
    // 3% chance per placement to grant a Power Placer
    if (Math.random() < 0.03) {
      setPowerPlacerCharges(c => c + 1);
      setTimeout(() => {
        setToast('POWER PLACER +1');
        setTimeout(() => setToast(null), 1000);
        if (!mutedRef.current && audioRef.current) {
          try {
            playTone(523, 0.1, 'triangle', 0.14);
            setTimeout(() => playTone(784, 0.12, 'triangle', 0.12), 70);
            setTimeout(() => playTone(1047, 0.16, 'sine', 0.1), 150);
          } catch {}
        }
      }, 500);
    }
    // 1% chance per placement to grant a Snake charge (rarer)
    else if (Math.random() < 0.01) {
      setSnakeCharges(c => c + 1);
      setTimeout(() => {
        setToast('🐍 SNAKE +1');
        setTimeout(() => setToast(null), 1200);
        if (!mutedRef.current && audioRef.current) {
          try {
            playTone(392, 0.12, 'sawtooth', 0.14);
            setTimeout(() => playTone(587, 0.14, 'sawtooth', 0.12), 80);
            setTimeout(() => playTone(784, 0.18, 'sine', 0.1), 170);
          } catch {}
        }
      }, 500);
    }
    // Bonus charge for big clears
    if (lines >= 3) {
      setOverdriveCharges(c => Math.min(OVERDRIVE_MAX, c + 1));
    }

    const fresh = new Set(placedKeys);
    setFreshCells(prev => {
      const n = new Set(prev);
      fresh.forEach(k => n.add(k));
      return n;
    });
    setTimeout(() => {
      setFreshCells(prev => {
        const n = new Set(prev);
        fresh.forEach(k => n.delete(k));
        return n;
      });
    }, 400);

    // Immediate refill: replace the placed slot with a fresh piece every time,
    // so players never have to drain all 3 before getting new pieces.
    const nextTrayArr = tray.map((p, i) => i === trayIndex ? makePiece(level) : p);
    const finalTray = nextTrayArr;
    const didRefill = true;

    // Deep crunch on placement
    playCrunch('place');
    vibe(12);

    const anyClear = lines > 0 || triggeredPowerPlacer;
    if (anyClear) {
      // Toast priority: power placer > powerups > multi-line > chain
      if (triggeredPowerPlacer) {
        setToast('POWER CLEAR!');
      } else if (activatedPowerups.length > 0) {
        const first = activatedPowerups[0].powerup.type;
        const names = {
          BLAST: 'BLAST!', SHUFFLE: 'SHUFFLE!', GRAVITY: 'GRAVITY!',
          MULT2: `BOOST ×${powerupMult}!`, MULT3: `BOOST ×${powerupMult}!`, MULT4: `BOOST ×${powerupMult}!`,
        };
        setToast(names[first] || 'POWERUP!');
      } else if (lines >= 3) setToast('CASCADE!');
      else if (lines >= 2) setToast('DOUBLE!');
      else if (newStreak >= 3) setToast(`CHAIN ×${streakMult}`);
      setTimeout(() => setToast(null), 1000);

      triggerShake(Math.min(3,
        lines + (newStreak >= 3 ? 1 : 0)
        + (activatedPowerups.length > 0 ? 1 : 0)
        + (triggeredPowerPlacer ? 2 : 0)
      ));

      // Break crunch + melodic line-clear stack
      playCrunch(triggeredPowerPlacer ? 'blast' : 'break');
      const baseFreq = 440 + (newStreak - 1) * 50;
      for (let i = 0; i < lines; i++) {
        setTimeout(() => playTone(baseFreq + i * 130, 0.22, 'sine', 0.22), 60 + i * 70);
      }
      if (newStreak >= 2) {
        setTimeout(() => playTone(baseFreq * 1.5, 0.24, 'triangle', 0.14), 60 + lines * 70);
      }
      // Power placer gets its own big descending sweep
      if (triggeredPowerPlacer) {
        playSweep(880, 110, 0.45, 'sawtooth', 0.18);
        setTimeout(() => playTone(147, 0.4, 'sine', 0.22), 40);
      }

      // Powerup activation sounds
      for (let i = 0; i < activatedPowerups.length; i++) {
        const ap = activatedPowerups[i];
        setTimeout(() => playPowerupSound(ap.powerup.type), 140 + i * 80);
      }

      if (triggeredPowerPlacer) vibe([60, 30, 60, 30, 100]);
      else if (lines >= 3) vibe([50, 30, 50, 30, 80]);
      else if (lines >= 2) vibe([30, 20, 40]);
      else vibe(25);
      if (activatedPowerups.length > 0) vibe([40, 40, 40, 40, 60]);

      const boardRect = boardRef.current?.getBoundingClientRect();
      if (boardRect) {
        const clearedCells = [];
        for (const k of clearMask) {
          const [r, c] = k.split(',').map(Number);
          const cell = next[r][c];
          // Skip particles for diamonds that are just cracking — unless
          // forceClearMask says they're being shattered (PP, etc.).
          const stayingDiamond =
            cell && cell.diamond && cell.diamond > 1 && !forceClearMask.has(k);
          if (cell && !stayingDiamond) {
            clearedCells.push({ r, c, color: cell.color });
          }
        }
        addParticles(clearedCells, boardRect);
      }

      addPopup(clearPts, streakMult, lines, powerupMult > 1 ? powerupMult : null);

      setBoard(next);
      setClearing({ rows: rc, cols: cc, extra: triggeredPowerPlacer ? Array.from(clearMask) : null });
      setTimeout(() => {
        // Clear every cell in the mask (lines + power-placer flood).
        // Diamond cells take 2 clears: hp 2 → 1 (cracked, stays), hp 1 → 0 (gone).
        // Cells in forceClearMask (PP flood) bypass the hp rule and remove fully.
        let cleared = next.map(r => [...r]);
        for (const k of clearMask) {
          const [r, c] = k.split(',').map(Number);
          const cell = cleared[r][c];
          const force = forceClearMask.has(k);
          if (!force && cell && cell.diamond && cell.diamond > 1) {
            cleared[r][c] = { ...cell, diamond: cell.diamond - 1 };
          } else {
            cleared[r][c] = null;
          }
        }

        // Apply positional powerup effects in order (BLAST/SHUFFLE/GRAVITY)
        for (const ap of activatedPowerups) {
          if (ap.powerup.type === 'BLAST') {
            for (let dr = -1; dr <= 1; dr++) {
              for (let dc = -1; dc <= 1; dc++) {
                const nr = ap.r + dr, nc = ap.c + dc;
                if (nr >= 0 && nr < GRID && nc >= 0 && nc < GRID) cleared[nr][nc] = null;
              }
            }
          } else if (ap.powerup.type === 'SHUFFLE') {
            cleared = shuffleBoard(cleared);
          } else if (ap.powerup.type === 'GRAVITY') {
            cleared = gravityStack(cleared);
          }
        }

        setBoard(cleared);
        setClearing({ rows: [], cols: [] });
        setTray(finalTray);
        if (didRefill) {
          setTrayKey(k => k + 1);
          playTone(520, 0.12, 'triangle', 0.15);
        }
        if (!overdriveActive && !snakeActive && !finalTray.filter(Boolean).some(p => canFit(p, cleared))) {
          setTimeout(() => {
            setGameOver(true);
            playSweep(440, 90, 0.8);
            vibe([100, 50, 100, 50, 200]);
          }, 400);
        }
      }, 440);
    } else {
      setBoard(next);
      setTray(finalTray);
      if (didRefill) {
        setTrayKey(k => k + 1);
        playTone(520, 0.12, 'triangle', 0.15);
      }
      if (!overdriveActive && !snakeActive && !finalTray.filter(Boolean).some(p => canFit(p, next))) {
        setTimeout(() => {
          setGameOver(true);
          playSweep(440, 90, 0.8);
          vibe([100, 50, 100, 50, 200]);
        }, 200);
      }
    }
  };

  // Compute which existing blocks a hypothetical placement at `cells` would
  // flood-clear (BFS through 4-connected filled cells). Used for Power Placer preview.
  const computeFloodCells = (brd, cells) => {
    const sim = brd.map(r => [...r]);
    const MARK = '__M__';
    for (const [r, c] of cells) sim[r][c] = MARK;
    const visited = new Set(cells.map(([r, c]) => `${r},${c}`));
    const queue = [...cells];
    const existing = [];
    while (queue.length) {
      const [r, c] = queue.shift();
      for (const [ar, ac] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nr = r + ar, nc = c + ac;
        if (nr < 0 || nr >= GRID || nc < 0 || nc >= GRID) continue;
        const k = `${nr},${nc}`;
        if (visited.has(k) || !sim[nr][nc]) continue;
        visited.add(k);
        queue.push([nr, nc]);
        if (sim[nr][nc] !== MARK) existing.push([nr, nc]);
      }
    }
    return existing;
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e) => {
      e.preventDefault();
      if (!boardRef.current) return;
      const rect = boardRef.current.getBoundingClientRect();
      const cs = rect.width / GRID;
      const d = dims(drag.piece.cells);
      const lift = e.pointerType === 'mouse' ? 0 : 80;
      const pW = d.cols * cs;
      const pH = d.rows * cs;
      const pLeft = e.clientX - pW / 2;
      const pTop = e.clientY - lift - pH / 2;
      // Flip moved=true once the pointer wanders past the tap threshold
      // so pointerup can distinguish a tap (rotate) from a drag (place).
      const TAP_SLOP = 8;
      const movedNow =
        drag.moved ||
        Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > TAP_SLOP;
      setDrag(prev => ({ ...prev, x: e.clientX, y: e.clientY, pLeft, pTop, pW, pH, moved: movedNow }));

      const overBoard =
        e.clientX >= rect.left - 40 && e.clientX <= rect.right + 40 &&
        e.clientY >= rect.top - 160 && e.clientY <= rect.bottom + 40;

      let newCells = null;
      let meta = {};

      if (overdriveActive) {
        if (overBoard) {
          const cursorR = Math.max(0, Math.min(GRID - 1,
            Math.round((e.clientY - lift - rect.top) / cs)));
          const cursorC = Math.max(0, Math.min(GRID - 1,
            Math.round((e.clientX - rect.left) / cs)));
          newCells = morphedPlacement(drag.piece.cells.length, board, cursorR, cursorC);
        }
      } else {
        // Smooth cursor-tracked placement.
        // 1) If the bbox-target cell is a valid placement, use it directly —
        //    one cell change per cursor cell, no jumps.
        // 2) Otherwise, snap to the nearest valid placement within a small
        //    radius around the target. Searching a local ring (not the whole
        //    grid, not piece-cell anchors) keeps the choice continuous as the
        //    cursor moves through deadspots.
        const cursorX = e.clientX - rect.left;
        const cursorY = e.clientY - rect.top;
        const targetCol = Math.round((pLeft - rect.left) / cs);
        const targetRow = Math.round((pTop - rect.top) / cs);
        const nCells = drag.piece.cells.length;

        const scoreAt = (r, c) => {
          let sx = 0, sy = 0;
          for (const [dr, dc] of drag.piece.cells) {
            sx += (c + dc + 0.5) * cs;
            sy += (r + dr + 0.5) * cs;
          }
          sx /= nCells; sy /= nCells;
          const dx = sx - cursorX, dy = sy - cursorY;
          return dx * dx + dy * dy;
        };

        let bestRow = -1, bestCol = -1;
        if (canPlace(drag.piece, targetRow, targetCol, board)) {
          bestRow = targetRow; bestCol = targetCol;
        } else {
          const SNAP_RADIUS = 2;
          const MAX_SNAP_CELLS = 2.2;
          const maxDistSq = (MAX_SNAP_CELLS * cs) * (MAX_SNAP_CELLS * cs);
          let bestDist = Infinity;
          for (let dr = -SNAP_RADIUS; dr <= SNAP_RADIUS; dr++) {
            for (let dc = -SNAP_RADIUS; dc <= SNAP_RADIUS; dc++) {
              const r = targetRow + dr, c = targetCol + dc;
              if (!canPlace(drag.piece, r, c, board)) continue;
              const d = scoreAt(r, c);
              if (d < bestDist && d <= maxDistSq) {
                bestDist = d; bestRow = r; bestCol = c;
              }
            }
          }
        }
        if (bestRow >= 0) {
          newCells = drag.piece.cells.map(([dr, dc]) => [bestRow + dr, bestCol + dc]);
          meta = { row: bestRow, col: bestCol };
        }
      }

      if (newCells) {
        // If Power Placer is armed, compute what else will go
        const floodCells = powerPlacerPending ? computeFloodCells(board, newCells) : null;
        setPreview({ ...meta, cells: newCells, floodCells });
      } else {
        setPreview(null);
      }
    };
    const up = () => {
      if (preview && preview.cells) {
        place(drag.trayIndex, preview.cells);
      } else if (!drag.moved) {
        // Tap with no drag movement — rotate the piece in the tray 90° CW.
        // Cheap haptic + blip so the rotation feels intentional.
        const idx = drag.trayIndex;
        setTray(curTray => curTray.map((p, i) =>
          i === idx && p ? { ...p, cells: rotateCells(p.cells) } : p));
        vibe(6);
        if (!mutedRef.current && audioRef.current) {
          try { playTone(520, 0.04, 'triangle', 0.08); } catch {}
        }
      }
      setDrag(null);
      setPreview(null);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [drag, preview, board, tray, canPlace, overdriveActive, powerPlacerPending]);

  const startDrag = (e, trayIndex) => {
    if (gameOver || paused || clearing.rows.length || clearing.cols.length || (clearing.extra && clearing.extra.length)) return;
    const piece = tray[trayIndex];
    if (!piece || !boardRef.current) return;
    initAudio();
    const rect = boardRef.current.getBoundingClientRect();
    const cs = rect.width / GRID;
    const d = dims(piece.cells);
    const lift = e.pointerType === 'mouse' ? 0 : 80;
    const pW = d.cols * cs;
    const pH = d.rows * cs;
    const pLeft = e.clientX - pW / 2;
    const pTop = e.clientY - lift - pH / 2;
    setDrag({
      piece,
      trayIndex,
      x: e.clientX,
      y: e.clientY,
      pLeft, pTop, pW, pH,
      // Track where the pointer went down so we can tell a tap (rotate)
      // from a drag (place). If total movement stays below the threshold
      // until pointerup, we treat it as a tap.
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    });
    e.preventDefault();
  };

  const previewSet = new Set();
  if (drag && preview && preview.cells) {
    for (const [r, c] of preview.cells) {
      previewSet.add(`${r},${c}`);
    }
  }
  const floodSet = new Set();
  if (drag && preview && preview.floodCells) {
    for (const [r, c] of preview.floodCells) {
      floodSet.add(`${r},${c}`);
    }
  }
  const clearSet = new Set();
  for (const r of clearing.rows) for (let c = 0; c < GRID; c++) clearSet.add(`${r},${c}`);
  for (const c of clearing.cols) for (let r = 0; r < GRID; r++) clearSet.add(`${r},${c}`);
  if (clearing.extra) for (const k of clearing.extra) clearSet.add(k);

  const mcolor = mulColor(multiplier);

  // Shared shell style for all screens
  const shellStyle = {
    // Fill the real visible viewport (handles mobile toolbars via dvh).
    // Falls back to 100vh in browsers that don't know dvh.
    height: '100dvh',
    minHeight: '100vh',
    maxHeight: '100dvh',
    width: '100%',
    background: 'radial-gradient(ellipse at top, #1a1440 0%, #0a0818 55%, #050410 100%)',
    color: '#fff',
    fontFamily: '"Rubik", system-ui, sans-serif',
    touchAction: 'manipulation',
    userSelect: 'none',
    WebkitUserSelect: 'none',
    overflow: 'hidden',
    position: 'relative',
  };

  const fontsAndKeyframes = (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Rubik+Mono+One&family=Rubik:wght@400;500;700;900&display=swap');
      @keyframes titleGlow {
        0%, 100% { filter: drop-shadow(0 0 30px rgba(168,85,247,0.5)); }
        50% { filter: drop-shadow(0 0 50px rgba(0,212,255,0.6)); }
      }
      @keyframes menuPulse {
        0%, 100% { transform: scale(1); box-shadow: 0 10px 40px rgba(168,85,247,0.4); }
        50% { transform: scale(1.02); box-shadow: 0 14px 50px rgba(168,85,247,0.6); }
      }
      @keyframes coinBob {
        0%, 100% { transform: translateY(0) rotate(-2deg); }
        50% { transform: translateY(-3px) rotate(2deg); }
      }
      @keyframes dailyGlow {
        0%, 100% { box-shadow: 0 0 0 2px rgba(255,214,10,0.5), 0 0 30px rgba(255,214,10,0.4); }
        50% { box-shadow: 0 0 0 3px rgba(255,214,10,0.8), 0 0 50px rgba(255,214,10,0.7); }
      }
      @keyframes celebrationIn {
        0% { transform: scale(0.3) rotate(-8deg); opacity: 0; }
        60% { transform: scale(1.15) rotate(2deg); opacity: 1; }
        100% { transform: scale(1) rotate(0); opacity: 1; }
      }
      @keyframes celebrationPulse {
        0%, 100% { filter: drop-shadow(0 0 30px rgba(255,123,46,0.8)); }
        50% { filter: drop-shadow(0 0 60px rgba(255,46,110,1)); }
      }
      @keyframes celebrationFadeOut {
        to { transform: scale(0.7) translateY(-20px); opacity: 0; }
      }
      @keyframes coinFly {
        0% { transform: translate(0, 0) scale(0.6); opacity: 0; }
        12% { transform: translate(0, -30px) scale(1.4); opacity: 1; }
        100% { transform: translate(0, -240px) scale(0.5); opacity: 0; }
      }
      @keyframes megaFlash {
        0%, 100% { opacity: 0; }
        25% { opacity: 1; }
      }
      @keyframes xpBarFill {
        from { filter: brightness(1); }
        50% { filter: brightness(1.8); }
        to { filter: brightness(1); }
      }
      @keyframes streakFlame {
        0%, 100% { transform: rotate(-4deg) scale(1); }
        50% { transform: rotate(4deg) scale(1.1); }
      }
      @keyframes snakeHeadPulse {
        0%, 100% { transform: scale(1); filter: brightness(1); }
        50% { transform: scale(1.08); filter: brightness(1.25); }
      }
      @keyframes snakeHudGlow {
        0%, 100% { box-shadow: 0 0 14px rgba(34,214,95,0.4), 0 0 26px rgba(0,255,194,0.25); }
        50% { box-shadow: 0 0 22px rgba(34,214,95,0.7), 0 0 40px rgba(0,255,194,0.4); }
      }
    `}</style>
  );

  const CoinBadge = ({ large }) => (
    <div style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      padding: large ? '8px 16px' : '6px 12px',
      background: 'linear-gradient(135deg, rgba(255,214,10,0.2), rgba(255,123,46,0.1))',
      border: '1px solid rgba(255,214,10,0.4)',
      borderRadius: 100,
      fontFamily: '"Rubik Mono One", monospace',
      fontSize: large ? 18 : 14,
      color: '#ffd60a',
      textShadow: '0 0 12px rgba(255,214,10,0.5)',
    }}>
      <span style={{ animation: 'coinBob 2s ease-in-out infinite', display: 'inline-block' }}>◉</span>
      <span>{coins}</span>
    </div>
  );

  // ------------------- MAIN MENU -------------------
  if (screen === 'menu') {
    return (
      <div style={shellStyle}>
        {fontsAndKeyframes}
        <div style={{
          padding: '40px 20px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 20,
          height: '100%',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          justifyContent: 'center',
        }}>
          {/* Top bar: coin balance */}
          <div style={{ position: 'absolute', top: 20, right: 20 }}>
            <CoinBadge />
          </div>

          {/* Title */}
          <div style={{ marginBottom: 8, animation: 'titleGlow 3s ease-in-out infinite' }}>
            <div style={{
              fontFamily: '"Rubik Mono One", monospace',
              fontSize: 64,
              letterSpacing: '-0.03em',
              lineHeight: 0.9,
              textAlign: 'center',
              background: 'linear-gradient(135deg, #00d4ff 0%, #a855f7 50%, #ff2e6e 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>CASCADE</div>
            <div style={{
              fontSize: 11,
              letterSpacing: '0.45em',
              color: 'rgba(255,255,255,0.45)',
              textAlign: 'center',
              marginTop: 8,
              fontWeight: 500,
            }}>8 × 8 · DROP · CLEAR</div>
          </div>

          {/* Level + XP progress bar */}
          <div style={{
            width: '100%',
            maxWidth: 320,
            padding: '12px 16px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(168,85,247,0.25)',
            borderRadius: 14,
            marginBottom: 4,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
              <div style={{
                fontFamily: '"Rubik Mono One", monospace',
                fontSize: 16,
                background: 'linear-gradient(135deg, #00d4ff, #a855f7, #ff2e6e)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                letterSpacing: '0.05em',
              }}>LVL {playerLevel}</div>
              <div style={{
                fontSize: 10,
                color: 'rgba(255,255,255,0.5)',
                fontFamily: '"Rubik Mono One", monospace',
                letterSpacing: '0.08em',
              }}>
                {xpIntoLevel(xp)} / {XP_PER_LEVEL} XP
              </div>
            </div>
            <div style={{
              height: 6,
              background: 'rgba(255,255,255,0.08)',
              borderRadius: 3,
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${(xpIntoLevel(xp) / XP_PER_LEVEL) * 100}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #00d4ff, #a855f7, #ff2e6e)',
                boxShadow: '0 0 10px rgba(168,85,247,0.6)',
                transition: 'width 500ms ease',
              }} />
            </div>
          </div>

          {/* Play streak */}
          {playStreak > 1 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              background: 'linear-gradient(135deg, rgba(255,123,46,0.22), rgba(255,46,110,0.15))',
              border: '1px solid rgba(255,123,46,0.45)',
              borderRadius: 100,
              fontFamily: '"Rubik Mono One", monospace',
              fontSize: 12,
              color: '#ffd60a',
              letterSpacing: '0.12em',
              boxShadow: '0 0 16px rgba(255,123,46,0.25)',
              marginBottom: 4,
            }}>
              <span style={{
                fontSize: 14,
                display: 'inline-block',
                animation: 'streakFlame 1.1s ease-in-out infinite',
              }}>🔥</span>
              <span>{playStreak}-DAY STREAK</span>
            </div>
          )}

          {/* Stats strip */}
          <div style={{
            display: 'flex',
            gap: 14,
            padding: '10px 16px',
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 14,
            marginBottom: 8,
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>BEST</div>
              <div style={{ fontFamily: '"Rubik Mono One", monospace', fontSize: 18, color: '#fff' }}>
                {persistedBest.toLocaleString()}
              </div>
            </div>
            <div style={{ width: 1, background: 'rgba(255,255,255,0.08)' }} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>GAMES</div>
              <div style={{ fontFamily: '"Rubik Mono One", monospace', fontSize: 18, color: '#7aeaff' }}>
                {gamesPlayed}
              </div>
            </div>
            <div style={{ width: 1, background: 'rgba(255,255,255,0.08)' }} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>CLEARS</div>
              <div style={{ fontFamily: '"Rubik Mono One", monospace', fontSize: 18, color: '#cb91fb' }}>
                {lifetimeClears}
              </div>
            </div>
          </div>

          {/* Daily bonus */}
          {canClaimDaily && (
            <button
              onClick={() => { initAudio(); claimDaily(); }}
              style={{
                padding: '12px 24px',
                fontFamily: '"Rubik Mono One", monospace',
                fontSize: 13,
                letterSpacing: '0.15em',
                color: '#0a0818',
                background: 'linear-gradient(135deg, #ffd60a, #ff7b2e)',
                border: 'none',
                borderRadius: 100,
                cursor: 'pointer',
                animation: 'dailyGlow 1.2s ease-in-out infinite',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span style={{ fontSize: 16 }}>🎁</span>
              <span>DAILY +{DAILY_BONUS}</span>
            </button>
          )}

          {/* Mode selector — pick Classic or Timed before hitting PLAY */}
          <div style={{
            display: 'flex',
            gap: 6,
            padding: 4,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 100,
          }}>
            {['endless', 'timed'].map((m) => {
              const active = mode === m;
              const label = m === 'endless' ? 'CLASSIC' : 'TIMED';
              const accent = m === 'endless'
                ? 'linear-gradient(135deg, #00d4ff, #a855f7)'
                : 'linear-gradient(135deg, #ff7b2e, #ff2e6e)';
              return (
                <button
                  key={m}
                  onClick={() => { initAudio(); setMode(m); }}
                  style={{
                    padding: '8px 18px',
                    fontFamily: '"Rubik Mono One", monospace',
                    fontSize: 11,
                    letterSpacing: '0.2em',
                    color: active ? '#fff' : 'rgba(255,255,255,0.55)',
                    background: active ? accent : 'transparent',
                    border: 'none',
                    borderRadius: 100,
                    cursor: 'pointer',
                    boxShadow: active ? '0 0 18px rgba(168,85,247,0.35)' : 'none',
                    transition: 'all 180ms',
                  }}
                >{label}</button>
              );
            })}
          </div>

          {/* PLAY — big primary button */}
          <button
            onClick={() => {
              initAudio();
              // Ensure modeRef is synced before reset reads it
              modeRef.current = mode;
              reset();
              checkPlayStreak();
              setScreen('game');
            }}
            style={{
              padding: '20px 60px',
              fontFamily: '"Rubik Mono One", monospace',
              fontSize: 22,
              letterSpacing: '0.2em',
              color: '#fff',
              background: 'linear-gradient(135deg, #a855f7, #ff2e6e)',
              border: 'none',
              borderRadius: 100,
              cursor: 'pointer',
              animation: 'menuPulse 2.5s ease-in-out infinite',
              minWidth: 240,
            }}
          >
            PLAY
          </button>

          {/* Secondary row */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              onClick={() => setScreen('shop')}
              style={{
                padding: '12px 26px',
                fontFamily: '"Rubik Mono One", monospace',
                fontSize: 13,
                letterSpacing: '0.15em',
                color: '#fff',
                background: 'linear-gradient(135deg, rgba(0,212,255,0.2), rgba(168,85,247,0.15))',
                border: '1px solid rgba(0,212,255,0.4)',
                borderRadius: 100,
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >🛒 SHOP</button>
            <button
              onClick={() => setScreen('stats')}
              style={{
                padding: '12px 26px',
                fontFamily: '"Rubik Mono One", monospace',
                fontSize: 13,
                letterSpacing: '0.15em',
                color: '#fff',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 100,
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: 6,
              }}
            >📊 STATS</button>
            <button
              onClick={() => {
                initAudio();
                setMuted(m => {
                  const next = !m;
                  if (!next && audioRef.current) {
                    try {
                      const ctx = audioRef.current;
                      if (ctx.state === 'suspended') ctx.resume();
                      const osc = ctx.createOscillator();
                      const g = ctx.createGain();
                      osc.type = 'sine';
                      osc.frequency.setValueAtTime(523, ctx.currentTime);
                      osc.frequency.setValueAtTime(784, ctx.currentTime + 0.08);
                      g.gain.setValueAtTime(0, ctx.currentTime);
                      g.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.01);
                      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
                      osc.connect(g); g.connect(ctx.destination);
                      osc.start(); osc.stop(ctx.currentTime + 0.3);
                    } catch {}
                  }
                  return next;
                });
              }}
              style={{
                padding: '12px 18px',
                fontFamily: '"Rubik Mono One", monospace',
                fontSize: 13,
                color: muted ? 'rgba(255,255,255,0.5)' : '#00d4ff',
                background: muted ? 'rgba(255,255,255,0.04)' : 'rgba(0,212,255,0.12)',
                border: `1px solid ${muted ? 'rgba(255,255,255,0.1)' : 'rgba(0,212,255,0.35)'}`,
                borderRadius: 100,
                cursor: 'pointer',
              }}
            >{muted ? '🔇' : '🎵'}</button>
          </div>

          {/* Inventory strip */}
          <div style={{
            marginTop: 10,
            display: 'flex',
            gap: 12,
            fontSize: 12,
            color: 'rgba(255,255,255,0.7)',
            fontFamily: '"Rubik Mono One", monospace',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>💥</span><span>{powerPlacerCharges}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>🐍</span><span>{snakeCharges}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>⚡</span><span>{overdriveCharges}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ------------------- SHOP -------------------
  if (screen === 'shop') {
    return (
      <div style={shellStyle}>
        {fontsAndKeyframes}
        <div style={{ padding: '20px 20px 40px', height: '100%', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <button
              onClick={() => setScreen('menu')}
              style={{
                padding: '8px 14px',
                fontFamily: '"Rubik Mono One", monospace',
                fontSize: 12,
                color: '#fff',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 100,
                cursor: 'pointer',
              }}
            >← BACK</button>
            <CoinBadge large />
          </div>

          <div style={{
            fontFamily: '"Rubik Mono One", monospace',
            fontSize: 36,
            letterSpacing: '-0.02em',
            background: 'linear-gradient(135deg, #00d4ff, #a855f7)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            marginBottom: 4,
          }}>SHOP</div>
          <div style={{
            fontSize: 11,
            letterSpacing: '0.3em',
            color: 'rgba(255,255,255,0.4)',
            marginBottom: 24,
          }}>SPEND COINS · STACK CHARGES</div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {SHOP.map((item) => {
              const affordable = coins >= item.price;
              const owned = item.id === 'pp' ? powerPlacerCharges
                : item.id === 'snake' ? snakeCharges
                : overdriveCharges;
              return (
                <div key={item.id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '16px 18px',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 16,
                }}>
                  <div style={{
                    width: 54,
                    height: 54,
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: 28,
                    background: item.id === 'pp'
                      ? 'linear-gradient(135deg, #ff7b2e, #ff2e6e)'
                      : item.id === 'snake'
                      ? 'linear-gradient(135deg, #22d65f, #00ffc2)'
                      : 'linear-gradient(135deg, #a855f7, #00d4ff)',
                    borderRadius: 14,
                    boxShadow: item.id === 'pp'
                      ? '0 0 20px rgba(255,123,46,0.4)'
                      : item.id === 'snake'
                      ? '0 0 20px rgba(34,214,95,0.45)'
                      : '0 0 20px rgba(168,85,247,0.4)',
                  }}>{item.glyph}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{
                      fontFamily: '"Rubik Mono One", monospace',
                      fontSize: 14,
                      letterSpacing: '0.05em',
                    }}>{item.label}</div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 }}>
                      {item.desc}
                    </div>
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 4, fontFamily: '"Rubik Mono One", monospace' }}>
                      OWNED: {owned}
                    </div>
                  </div>
                  <button
                    onClick={() => buyItem(item)}
                    disabled={!affordable}
                    style={{
                      padding: '10px 14px',
                      fontFamily: '"Rubik Mono One", monospace',
                      fontSize: 12,
                      color: affordable ? '#0a0818' : 'rgba(255,255,255,0.3)',
                      background: affordable
                        ? 'linear-gradient(135deg, #ffd60a, #ff7b2e)'
                        : 'rgba(255,255,255,0.06)',
                      border: 'none',
                      borderRadius: 100,
                      cursor: affordable ? 'pointer' : 'default',
                      display: 'flex', alignItems: 'center', gap: 5,
                      minWidth: 78,
                      justifyContent: 'center',
                    }}
                  >
                    <span>◉</span><span>{item.price}</span>
                  </button>
                </div>
              );
            })}
          </div>

          <div style={{
            marginTop: 24,
            padding: 14,
            background: 'rgba(255,255,255,0.02)',
            border: '1px dashed rgba(255,255,255,0.1)',
            borderRadius: 12,
            fontSize: 11,
            color: 'rgba(255,255,255,0.5)',
            lineHeight: 1.5,
          }}>
            Earn coins from clears and big cascades. Return daily for a free bonus. Charges persist across games.
          </div>
        </div>
      </div>
    );
  }

  // ------------------- STATS -------------------
  if (screen === 'stats') {
    return (
      <div style={shellStyle}>
        {fontsAndKeyframes}
        <div style={{ padding: '20px 20px 40px', height: '100%', overflowY: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <button
              onClick={() => setScreen('menu')}
              style={{
                padding: '8px 14px',
                fontFamily: '"Rubik Mono One", monospace',
                fontSize: 12,
                color: '#fff',
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 100,
                cursor: 'pointer',
              }}
            >← BACK</button>
            <CoinBadge large />
          </div>

          <div style={{
            fontFamily: '"Rubik Mono One", monospace',
            fontSize: 36,
            letterSpacing: '-0.02em',
            background: 'linear-gradient(135deg, #ffd60a, #ff7b2e)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            marginBottom: 24,
          }}>STATS</div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            {[
              { label: 'LEVEL', value: playerLevel, color: '#a855f7' },
              { label: 'TOTAL XP', value: xp.toLocaleString(), color: '#00d4ff' },
              { label: 'HIGH SCORE', value: persistedBest.toLocaleString(), color: '#fff' },
              { label: 'PLAY STREAK', value: `${playStreak} 🔥`, color: '#ff7b2e' },
              { label: 'GAMES PLAYED', value: gamesPlayed, color: '#7aeaff' },
              { label: 'LINES CLEARED', value: lifetimeClears, color: '#cb91fb' },
              { label: 'COINS EARNED', value: lifetimeCoinsEarned, color: '#ffd60a' },
            ].map((s) => (
              <div key={s.label} style={{
                padding: 16,
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 14,
              }}>
                <div style={{ fontSize: 9, letterSpacing: '0.25em', color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>
                  {s.label}
                </div>
                <div style={{
                  fontFamily: '"Rubik Mono One", monospace',
                  fontSize: 22,
                  color: s.color,
                  marginTop: 4,
                }}>
                  {s.value}
                </div>
              </div>
            ))}
          </div>

          <div style={{
            marginTop: 20,
            padding: 16,
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 14,
          }}>
            <div style={{ fontSize: 10, letterSpacing: '0.25em', color: 'rgba(255,255,255,0.45)', fontWeight: 600, marginBottom: 10 }}>
              INVENTORY
            </div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 22 }}>💥</span>
                <div>
                  <div style={{ fontFamily: '"Rubik Mono One", monospace', fontSize: 20 }}>{powerPlacerCharges}</div>
                  <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.4)' }}>POWER PLACERS</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 22 }}>🐍</span>
                <div>
                  <div style={{ fontFamily: '"Rubik Mono One", monospace', fontSize: 20 }}>{snakeCharges}</div>
                  <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.4)' }}>SNAKES</div>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 22 }}>⚡</span>
                <div>
                  <div style={{ fontFamily: '"Rubik Mono One", monospace', fontSize: 20 }}>{overdriveCharges}</div>
                  <div style={{ fontSize: 9, letterSpacing: '0.2em', color: 'rgba(255,255,255,0.4)' }}>OVERDRIVES</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ------------------- GAME (default) -------------------

  return (
    <div style={{
      minHeight: '100dvh',
      width: '100%',
      background: 'radial-gradient(ellipse at top, #1a1440 0%, #0a0818 55%, #050410 100%)',
      color: '#fff',
      fontFamily: '"Rubik", system-ui, sans-serif',
      touchAction: 'manipulation',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      position: 'relative',
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rubik+Mono+One&family=Rubik:wght@400;500;700;900&display=swap');
        @keyframes toastIn {
          0% { opacity: 0; transform: translate(-50%, -50%) scale(0.4); }
          25% { opacity: 1; transform: translate(-50%, -50%) scale(1.2); }
          50% { transform: translate(-50%, -50%) scale(0.95); }
          75% { transform: translate(-50%, -50%) scale(1.05); }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(1.1); }
        }
        @keyframes scoreJump {
          0%, 100% { transform: scale(1); }
          40% { transform: scale(1.2); }
        }
        @keyframes gridGlow {
          0%, 100% { box-shadow: 0 0 0 1px rgba(255,255,255,0.04), inset 0 0 80px rgba(168,85,247,0.08); }
          50% { box-shadow: 0 0 0 1px rgba(255,255,255,0.06), inset 0 0 80px rgba(0,212,255,0.10); }
        }
        @keyframes dangerPulse {
          0%, 100% { box-shadow: 0 0 0 1px rgba(255,46,110,0.2), 0 0 40px rgba(255,46,110,0.15), inset 0 0 60px rgba(255,46,110,0.1); }
          50% { box-shadow: 0 0 0 1.5px rgba(255,46,110,0.5), 0 0 60px rgba(255,46,110,0.35), inset 0 0 80px rgba(255,46,110,0.2); }
        }
        @keyframes blockSpawn {
          0% { transform: scale(0) rotate(-90deg); opacity: 0; }
          60% { transform: scale(1.2) rotate(8deg); opacity: 1; }
          100% { transform: scale(1) rotate(0); opacity: 1; }
        }
        @keyframes diamondCrack {
          0%   { transform: scale(1) translate(0, 0) rotate(0); }
          15%  { transform: scale(1.08) translate(-2px, -1px) rotate(-3deg); filter: brightness(1.4); }
          30%  { transform: scale(0.96) translate(2px, 1px) rotate(2deg); filter: brightness(1.2); }
          45%  { transform: scale(1.02) translate(-1px, 1px) rotate(-1.5deg); }
          60%  { transform: scale(1) translate(1px, -1px) rotate(1deg); }
          75%  { transform: scale(1) translate(-0.5px, 0) rotate(-0.5deg); }
          100% { transform: scale(1) translate(0, 0) rotate(0); filter: brightness(1); }
        }
        @keyframes trayEnter {
          0% { transform: scale(0) translateY(20px); opacity: 0; }
          100% { transform: scale(1) translateY(0); opacity: 1; }
        }
        @keyframes trayIdle {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        @keyframes popupRise {
          0% { opacity: 0; transform: translate(-50%, -50%) translateY(0) scale(0.4); }
          20% { opacity: 1; transform: translate(-50%, -50%) translateY(-15px) scale(1.3); }
          45% { transform: translate(-50%, -50%) translateY(-35px) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -50%) translateY(-90px) scale(0.85); }
        }
        @keyframes particleFly {
          0% { transform: translate(0,0) scale(1) rotate(0); opacity: 1; }
          100% { transform: translate(var(--dx), var(--dy)) scale(0) rotate(var(--rot)); opacity: 0; }
        }
        @keyframes multiplierPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.08); }
        }
        @keyframes powerupPulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.15); opacity: 0.85; }
        }
        @keyframes powerupBurst {
          0% { transform: translate(-50%,-50%) scale(0.2); opacity: 0; }
          20% { opacity: 1; }
          100% { transform: translate(-50%,-50%) scale(4); opacity: 0; }
        }
        @keyframes dangerBadge {
          0%, 100% { transform: scale(1); box-shadow: 0 0 18px rgba(255,46,110,0.6); }
          50% { transform: scale(1.08); box-shadow: 0 0 28px rgba(255,46,110,0.9); }
        }
        @keyframes emergencyPulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 18px rgba(168,85,247,0.6), 0 0 32px rgba(255,46,110,0.4); }
          50% { transform: scale(1.05); box-shadow: 0 0 32px rgba(168,85,247,0.9), 0 0 56px rgba(255,46,110,0.6); }
        }
        @keyframes emergencyHint {
          0%, 100% { transform: translateX(-50%) translateY(0); opacity: 0.9; }
          50% { transform: translateX(-50%) translateY(-3px); opacity: 1; }
        }
        @keyframes overdriveGlow {
          0%, 100% { box-shadow: 0 0 0 2px rgba(0,255,194,0.4), 0 0 40px rgba(0,255,194,0.25), inset 0 0 60px rgba(0,255,194,0.08); }
          50% { box-shadow: 0 0 0 2px rgba(0,255,194,0.7), 0 0 60px rgba(0,255,194,0.5), inset 0 0 80px rgba(0,212,255,0.15); }
        }
        @keyframes overdrivePreview {
          0%, 100% { opacity: 0.7; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.06); }
        }
        @keyframes previewPulse {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 0.85; }
        }
        @keyframes floodDanger {
          0%, 100% { opacity: 0.55; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.08); }
        }
        @keyframes floodDangerRing {
          0% { transform: translate(-50%,-50%) scale(0.8); opacity: 1; }
          100% { transform: translate(-50%,-50%) scale(1.6); opacity: 0; }
        }
        @keyframes shake1 {
          0%, 100% { transform: translate(0, 0); }
          25% { transform: translate(-3px, 2px); }
          75% { transform: translate(3px, -2px); }
        }
        @keyframes shake2 {
          0%, 100% { transform: translate(0, 0); }
          15% { transform: translate(-6px, 3px); }
          35% { transform: translate(5px, -4px); }
          55% { transform: translate(-4px, 3px); }
          75% { transform: translate(4px, -2px); }
        }
        @keyframes shake3 {
          0%, 100% { transform: translate(0, 0); }
          10% { transform: translate(-9px, 4px) rotate(-0.5deg); }
          25% { transform: translate(8px, -5px) rotate(0.5deg); }
          40% { transform: translate(-7px, 4px) rotate(-0.3deg); }
          55% { transform: translate(6px, -3px); }
          70% { transform: translate(-4px, 2px); }
          85% { transform: translate(3px, -1px); }
        }
      `}</style>

      <div ref={shakeRef} style={{
        height: '100%',
        padding: '6px 10px max(8px, env(safe-area-inset-bottom))',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        boxSizing: 'border-box',
      }}>

        {/* Header */}
        <div style={{
          width: '100%',
          maxWidth: 420,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
        }}>
          <div>
            <div style={{
              fontFamily: '"Rubik Mono One", monospace',
              fontSize: 26,
              letterSpacing: '-0.02em',
              lineHeight: 1,
              background: 'linear-gradient(135deg, #00d4ff 0%, #a855f7 50%, #ff2e6e 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>CASCADE</div>
            <div style={{
              fontSize: 10,
              letterSpacing: '0.3em',
              color: 'rgba(255,255,255,0.4)',
              marginTop: 4,
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}>
              {(() => {
                // Tier-based color: purple (easy) → orange (mid) → red (brutal)
                const tier = level >= 10 ? 3 : level >= 6 ? 2 : level >= 3 ? 1 : 0;
                const palette = [
                  { bg: 'rgba(168,85,247,0.2)', fg: '#cb91fb' },
                  { bg: 'rgba(255,123,46,0.22)', fg: '#ffb87a' },
                  { bg: 'rgba(255,46,110,0.22)', fg: '#ff7aa4' },
                  { bg: 'rgba(255,46,46,0.28)', fg: '#ff5252' },
                ][tier];
                return (
                  <span style={{
                    display: 'inline-block',
                    padding: '2px 6px',
                    background: palette.bg,
                    borderRadius: 4,
                    color: palette.fg,
                    fontWeight: 700,
                    transition: 'all 400ms',
                  }}>LVL {level}</span>
                );
              })()}
              <span>{clearCount} CLEARS</span>
            </div>
            <div style={{
              marginTop: 6,
              width: 100,
              height: 3,
              background: 'rgba(255,255,255,0.06)',
              borderRadius: 2,
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${levelProgress * 100}%`,
                height: '100%',
                background: 'linear-gradient(90deg, #00d4ff, #a855f7)',
                transition: 'width 400ms ease',
              }} />
            </div>
          </div>
          <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setScreen('menu')}
                style={{
                  padding: '4px 10px',
                  fontFamily: '"Rubik Mono One", monospace',
                  fontSize: 10,
                  color: 'rgba(255,255,255,0.5)',
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 100,
                  cursor: 'pointer',
                  letterSpacing: '0.1em',
                }}
              >← MENU</button>
              <CoinBadge />
            </div>
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              {mode === 'timed' && (
                <div>
                  <div style={{ fontSize: 9, letterSpacing: '0.25em', color: 'rgba(255,255,255,0.35)', fontWeight: 600 }}>TIME</div>
                  <div style={{
                    fontFamily: '"Rubik Mono One", monospace',
                    fontSize: 22,
                    lineHeight: 1,
                    color: timeRemaining <= 5 ? '#ff2e6e' : timeRemaining <= 10 ? '#ffd60a' : '#00ffc2',
                    textShadow: timeRemaining <= 5
                      ? '0 0 16px rgba(255,46,110,0.7)'
                      : timeRemaining <= 10
                      ? '0 0 14px rgba(255,214,10,0.55)'
                      : '0 0 12px rgba(0,255,194,0.45)',
                    animation: timeRemaining <= 5 && !overdriveActive && !snakeActive
                      ? 'dangerBadge 400ms ease-in-out infinite'
                      : 'none',
                  }}>
                    {Math.ceil(timeRemaining).toString().padStart(2, '0')}
                  </div>
                </div>
              )}
              <div>
                <div style={{ fontSize: 9, letterSpacing: '0.25em', color: 'rgba(255,255,255,0.35)', fontWeight: 600 }}>BEST</div>
                <div style={{ fontFamily: '"Rubik Mono One", monospace', fontSize: 16, color: 'rgba(255,255,255,0.6)' }}>
                  {best.toString().padStart(4, '0')}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 9, letterSpacing: '0.25em', color: 'rgba(255,255,255,0.35)', fontWeight: 600 }}>SCORE</div>
                <div
                  key={Math.floor(displayScore / 50)}
                  style={{
                    fontFamily: '"Rubik Mono One", monospace',
                    fontSize: 28,
                    color: '#fff',
                    animation: 'scoreJump 350ms ease',
                    textShadow: '0 0 20px rgba(168,85,247,0.5)',
                    lineHeight: 1,
                  }}
                >
                  {displayScore.toString().padStart(4, '0')}
                </div>
              </div>
            </div>
            {/* Reserved slot for CHAIN / DANGER badges. minHeight keeps
                the row from collapsing when neither is visible, so board
                size stays constant while they toggle. */}
            <div style={{ marginTop: 2, minHeight: 22, display: 'flex', alignItems: 'center', gap: 6 }}>
            {(streak >= 2) && (
              <div style={{
                padding: '4px 10px',
                background: `linear-gradient(135deg, ${mcolor}33, ${mcolor}11)`,
                border: `1px solid ${mcolor}88`,
                borderRadius: 100,
                fontFamily: '"Rubik Mono One", monospace',
                fontSize: 11,
                color: mcolor,
                letterSpacing: '0.05em',
                animation: 'multiplierPulse 600ms ease-in-out infinite',
                boxShadow: `0 0 16px ${mcolor}55`,
              }}>
                CHAIN ×{multiplier}
              </div>
            )}
            {danger && (
              <div style={{
                padding: '4px 10px',
                background: 'linear-gradient(135deg, rgba(255,46,110,0.3), rgba(255,46,110,0.08))',
                border: '1px solid rgba(255,46,110,0.8)',
                borderRadius: 100,
                fontFamily: '"Rubik Mono One", monospace',
                fontSize: 11,
                color: '#ff2e6e',
                letterSpacing: '0.1em',
                animation: 'dangerBadge 500ms ease-in-out infinite',
                boxShadow: '0 0 18px rgba(255,46,110,0.6)',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}>
                <span style={{ fontSize: 13 }}>⚠</span> DANGER
              </div>
            )}
            </div>
          </div>
        </div>

        {/* Board — takes full container width, always square */}
        <div style={{
          position: 'relative',
          // Reserve vertical room for HUD + tray + buttons so everything is
          // visible without scroll when the page is locked (PWA mode).
          // Regular browser tabs can scroll, so this is a fit-target, not a cap.
          width: 'min(100%, 440px, calc(100dvh - 280px))',
          alignSelf: 'center',
        }}>
          {/* Snake mode HUD — shows above the board while snake is active */}
          {snakeActive && (
            <div style={{
              position: 'absolute',
              top: -40,
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 16px',
              background: 'linear-gradient(135deg, rgba(34,214,95,0.3), rgba(0,255,194,0.2))',
              border: '1px solid rgba(34,214,95,0.6)',
              borderRadius: 100,
              fontFamily: '"Rubik Mono One", monospace',
              fontSize: 12,
              letterSpacing: '0.15em',
              color: '#aaffcc',
              whiteSpace: 'nowrap',
              zIndex: 30,
              animation: 'snakeHudGlow 900ms ease-in-out infinite',
              textShadow: '0 0 10px rgba(0,255,194,0.7)',
            }}>
              <span style={{ fontSize: 16 }}>🐍</span>
              <span>ATE {snakeEaten}</span>
              <span style={{
                padding: '1px 8px',
                background: 'rgba(0,0,0,0.4)',
                borderRadius: 100,
                fontSize: 10,
                color: '#aaffcc',
                letterSpacing: '0.12em',
              }}>SWIPE</span>
            </div>
          )}
          <div
            ref={boardRef}
            onPointerDown={snakeSwipe.onPointerDown}
            onPointerMove={snakeSwipe.onPointerMove}
            onPointerUp={snakeSwipe.onPointerUp}
            onPointerCancel={snakeSwipe.onPointerCancel}
            style={{
              width: '100%',
              aspectRatio: '1 / 1',
              display: 'grid',
              gridTemplateColumns: `repeat(${GRID}, 1fr)`,
              gridTemplateRows: `repeat(${GRID}, 1fr)`,
              gap: 2,
              padding: 6,
              touchAction: snakeActive ? 'none' : 'auto',
              background: overdriveActive
                ? 'linear-gradient(135deg, rgba(0,255,194,0.15), rgba(0,212,255,0.1))'
                : danger
                ? 'linear-gradient(135deg, rgba(255,46,110,0.12), rgba(255,123,46,0.08))'
                : 'linear-gradient(135deg, rgba(168,85,247,0.08), rgba(0,212,255,0.05))',
              borderRadius: 16,
              border: '1px solid rgba(255,255,255,0.06)',
              animation: overdriveActive
                ? 'overdriveGlow 800ms ease-in-out infinite'
                : danger
                ? 'dangerPulse 900ms ease-in-out infinite'
                : 'gridGlow 4s ease-in-out infinite',
              position: 'relative',
            }}
          >
            {Array.from({ length: GRID * GRID }).map((_, i) => {
              const r = Math.floor(i / GRID);
              const c = i % GRID;
              const cell = board[r][c];
              const key = `${r},${c}`;
              const isClearing = clearSet.has(key);
              const isPreview = previewSet.has(key);
              const isFresh = freshCells.has(key);
              const isFlood = floodSet.has(key);
              // Diamonds with hp>1 don't actually disappear on a normal line
              // clear — they crack in place. Reroute the visual so the Block
              // shakes + reveals the crack instead of scaling to zero.
              const inExtra = clearing.extra ? clearing.extra.includes(key) : false;
              const isCrackingDiamond =
                isClearing && !inExtra && cell?.diamond && cell.diamond > 1;
              const isClearingForBlock = isClearing && !isCrackingDiamond;
              const previewColor = drag?.piece.color;
              return (
                <div
                  key={i}
                  style={{
                    gridRow: r + 1,
                    gridColumn: c + 1,
                    position: 'relative',
                    borderRadius: 6,
                    background: cell ? 'transparent' : 'rgba(255,255,255,0.025)',
                    boxShadow: cell ? 'none' : 'inset 0 0 0 1px rgba(255,255,255,0.02)',
                  }}
                >
                  {cell && (
                    <div style={{ position: 'absolute', inset: 0 }}>
                      <Block color={cell.color} size={boardCell - 2} clearing={isClearingForBlock} cracking={isCrackingDiamond} fresh={isFresh} powerup={cell.powerup} diamond={cell.diamond} fill />
                    </div>
                  )}
                  {/* Flood preview: EXISTING block about to be destroyed by Power Placer */}
                  {isFlood && cell && !isClearing && (
                    <div style={{
                      position: 'absolute',
                      inset: 1,
                      borderRadius: 6,
                      background: 'radial-gradient(circle, rgba(255,214,10,0.55), rgba(255,46,110,0.45) 70%, rgba(255,46,110,0.2))',
                      boxShadow: '0 0 14px rgba(255,123,46,0.8), inset 0 0 8px rgba(255,214,10,0.5)',
                      mixBlendMode: 'screen',
                      animation: 'floodDanger 500ms ease-in-out infinite',
                      pointerEvents: 'none',
                    }} />
                  )}
                  {isPreview && !cell && previewColor && (
                    <div style={{
                      position: 'absolute',
                      inset: 0,
                      animation: overdriveActive
                        ? 'overdrivePreview 500ms ease-in-out infinite'
                        : powerPlacerPending
                        ? 'floodDanger 450ms ease-in-out infinite'
                        : 'previewPulse 700ms ease-in-out infinite',
                      filter: overdriveActive
                        ? `drop-shadow(0 0 12px ${previewColor.main})`
                        : powerPlacerPending
                        ? 'drop-shadow(0 0 10px #ffd60a) drop-shadow(0 0 16px #ff2e6e)'
                        : 'none',
                    }}>
                      <Block
                        color={powerPlacerPending
                          ? { main: '#ff7b2e', light: '#ffd60a', dark: '#a30d43' }
                          : previewColor}
                        size={boardCell - 2}
                        ghost
                        fill
                      />
                    </div>
                  )}
                </div>
              );
            })}

            {/* SNAKE body segments — positioned in the same CSS grid */}
            {snakeActive && snakeBody.map((seg, i) => {
              const isHead = i === 0;
              const len = snakeBody.length;
              const t = 1 - i / Math.max(len + 1, 5);  // head=1, tail=~0.2
              const arrow = snakeDir === 'up' ? '▲' : snakeDir === 'down' ? '▼' : snakeDir === 'left' ? '◀' : '▶';
              return (
                <div
                  key={`snake-${i}`}
                  style={{
                    gridRow: seg.r + 1,
                    gridColumn: seg.c + 1,
                    position: 'relative',
                    borderRadius: isHead ? 7 : 5,
                    background: isHead
                      ? 'linear-gradient(135deg, #aaffcc 0%, #22d65f 50%, #00ffc2 100%)'
                      : `linear-gradient(135deg, rgba(34,214,95,${0.35 + t*0.55}) 0%, rgba(0,255,194,${0.25 + t*0.5}) 100%)`,
                    boxShadow: isHead
                      ? '0 0 14px rgba(0,255,194,0.95), 0 0 28px rgba(34,214,95,0.7), inset 0 0 0 2px rgba(255,255,255,0.4)'
                      : `inset 0 0 0 1px rgba(255,255,255,${t * 0.3}), 0 0 ${6 + t*8}px rgba(0,255,194,${t*0.5})`,
                    zIndex: 20,
                    display: 'grid',
                    placeItems: 'center',
                    transition: 'background 150ms linear',
                    animation: isHead ? 'snakeHeadPulse 380ms ease-in-out infinite' : 'none',
                  }}
                >
                  {isHead && (
                    <div style={{
                      fontFamily: '"Rubik Mono One", monospace',
                      fontSize: Math.max(10, (boardCell || 32) * 0.45),
                      color: '#0a3d1f',
                      fontWeight: 900,
                      textShadow: '0 0 8px rgba(255,255,255,0.8)',
                      lineHeight: 1,
                    }}>{arrow}</div>
                  )}
                </div>
              );
            })}

            {toast && (
              <div style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                fontFamily: '"Rubik Mono One", monospace',
                fontSize: toast.startsWith('CASCADE') ? 46 : toast.startsWith('LEVEL') ? 40 : 36,
                letterSpacing: '-0.02em',
                color: '#fff',
                textShadow: toast.startsWith('CASCADE')
                  ? '0 0 40px #a855f7, 0 0 80px #ff2e6e'
                  : toast.startsWith('LEVEL')
                  ? '0 0 30px #00d4ff, 0 0 60px #a855f7'
                  : '0 0 30px #ffd60a, 0 0 60px #ff7b2e',
                animation: 'toastIn 1000ms ease-out forwards',
                pointerEvents: 'none',
                zIndex: 20,
                whiteSpace: 'nowrap',
              }}>
                {toast}
              </div>
            )}

            {popups.map(p => (
              <div
                key={p.id}
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  fontFamily: '"Rubik Mono One", monospace',
                  fontSize: 34,
                  color: p.color,
                  textShadow: `0 0 24px ${p.color}, 0 2px 8px rgba(0,0,0,0.5)`,
                  animation: 'popupRise 1100ms ease-out forwards',
                  pointerEvents: 'none',
                  zIndex: 25,
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 6,
                }}
              >
                +{p.value}
                {p.mul && (
                  <span style={{
                    fontSize: 16,
                    color: '#fff',
                    opacity: 0.85,
                    fontWeight: 700,
                  }}>×{p.mul}</span>
                )}
                {p.pwrMult && (
                  <span style={{
                    fontSize: 18,
                    color: '#ffd60a',
                    fontWeight: 900,
                    textShadow: '0 0 12px #ffd60a',
                  }}>⚡×{p.pwrMult}</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Tray */}
        <div style={{
          width: '100%',
          maxWidth: 440,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 6,
          padding: 8,
          background: 'rgba(255,255,255,0.02)',
          borderRadius: 12,
          border: '1px solid rgba(255,255,255,0.05)',
        }}>
          {tray.map((piece, i) => {
            const isDragging = drag?.trayIndex === i && drag?.moved;
            return (
              <TrayPiece
                key={piece?.id ? `p-${piece.id}` : `empty-${trayKey}-${i}`}
                piece={piece}
                faded={isDragging}
                slotSize={95}
                onPointerDown={(e) => startDrag(e, i)}
              />
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center', width: '100%' }}>
          {/* Row break forces AUDIO + NEW GAME onto a second line below the powerups */}
          <div style={{ flexBasis: '100%', height: 0, order: 5 }} />
          <button
            onClick={() => {
              initAudio();
              setMuted(m => {
                const next = !m;
                if (!next && audioRef.current) {
                  try {
                    const ctx = audioRef.current;
                    if (ctx.state === 'suspended') ctx.resume();
                    const osc = ctx.createOscillator();
                    const g = ctx.createGain();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(523, ctx.currentTime);
                    osc.frequency.setValueAtTime(784, ctx.currentTime + 0.08);
                    g.gain.setValueAtTime(0, ctx.currentTime);
                    g.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.01);
                    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
                    osc.connect(g); g.connect(ctx.destination);
                    osc.start();
                    osc.stop(ctx.currentTime + 0.3);
                  } catch {}
                }
                return next;
              });
            }}
            style={{
              order: 10,
              padding: '7px 12px',
              fontFamily: '"Rubik", sans-serif',
              fontSize: 10,
              letterSpacing: '0.12em',
              fontWeight: 700,
              color: muted ? 'rgba(255,255,255,0.5)' : '#00d4ff',
              background: muted ? 'rgba(255,255,255,0.04)' : 'rgba(0,212,255,0.12)',
              border: `1px solid ${muted ? 'rgba(255,255,255,0.08)' : 'rgba(0,212,255,0.35)'}`,
              borderRadius: 100,
              cursor: 'pointer',
              transition: 'all 200ms',
            }}
          >
            {muted ? '🔇 AUDIO' : '🎵 AUDIO'}
          </button>

          {/* OVERDRIVE button — the star of the show */}
          {(() => {
            const hasCharges = overdriveCharges > 0;
            const emergency = danger && hasCharges && !overdriveActive;
            return (
              <div style={{ position: 'relative', flex: '1 1 0', minWidth: 0, maxWidth: 170 }}>
                {emergency && (
                  <div style={{
                    position: 'absolute',
                    bottom: 'calc(100% + 6px)',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    padding: '4px 10px',
                    background: 'rgba(255,46,110,0.2)',
                    border: '1px solid rgba(255,46,110,0.8)',
                    borderRadius: 100,
                    fontFamily: '"Rubik Mono One", monospace',
                    fontSize: 10,
                    color: '#ff2e6e',
                    letterSpacing: '0.15em',
                    whiteSpace: 'nowrap',
                    animation: 'emergencyHint 600ms ease-in-out infinite',
                    boxShadow: '0 0 14px rgba(255,46,110,0.5)',
                    pointerEvents: 'none',
                  }}>
                    USE IT NOW ↓
                  </div>
                )}
                <button
                  onClick={activateOverdrive}
                  disabled={!hasCharges || overdriveActive || gameOver}
                  style={{
                    padding: '7px 14px',
                    fontFamily: '"Rubik Mono One", monospace',
                    fontSize: 11,
                    letterSpacing: '0.08em',
                    color: overdriveActive
                      ? '#0a0818'
                      : hasCharges
                      ? '#fff'
                      : 'rgba(255,255,255,0.25)',
                    background: overdriveActive
                      ? 'linear-gradient(135deg, #00ffc2, #00d4ff)'
                      : hasCharges
                      ? 'linear-gradient(135deg, #a855f7, #00d4ff)'
                      : 'rgba(255,255,255,0.04)',
                    border: `1.5px solid ${overdriveActive ? '#00ffc2' : hasCharges ? 'rgba(168,85,247,0.6)' : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: 100,
                    cursor: hasCharges && !overdriveActive ? 'pointer' : 'default',
                    transition: 'all 200ms',
                    boxShadow: overdriveActive
                      ? '0 0 28px rgba(0,255,194,0.7), 0 0 12px rgba(0,212,255,0.6)'
                      : emergency
                      ? '0 0 22px rgba(168,85,247,0.7)'
                      : hasCharges
                      ? '0 0 10px rgba(168,85,247,0.25)'
                      : 'none',
                    animation: emergency ? 'emergencyPulse 600ms ease-in-out infinite' : 'none',
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {overdriveActive ? (
                    <>
                      <span>⚡</span>
                      <span>{overdriveRemaining.toFixed(1)}s</span>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: 14 }}>⚡</span>
                      <span style={{
                        padding: '2px 6px',
                        background: hasCharges ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.08)',
                        borderRadius: 100,
                        fontSize: 11,
                        fontWeight: 700,
                      }}>
                        {overdriveCharges}
                      </span>
                    </>
                  )}
                </button>
                {/* Timer progress bar under button when active */}
                {overdriveActive && (
                  <div style={{
                    position: 'absolute',
                    bottom: -6,
                    left: 8,
                    right: 8,
                    height: 3,
                    background: 'rgba(0,0,0,0.3)',
                    borderRadius: 2,
                    overflow: 'hidden',
                  }}>
                    <div style={{
                      width: `${(overdriveRemaining / (OVERDRIVE_DURATION_MS / 1000)) * 100}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, #00ffc2, #00d4ff)',
                      transition: 'width 50ms linear',
                    }} />
                  </div>
                )}
              </div>
            );
          })()}

          {/* SNAKE button */}
          {(() => {
            const hasSnake = snakeCharges > 0;
            const snakeEmergency = danger && hasSnake && !snakeActive && !overdriveActive && !powerPlacerPending;
            return (
              <button
                onClick={activateSnake}
                disabled={!hasSnake || snakeActive || gameOver || overdriveActive || powerPlacerPending}
                style={{
                  flex: '1 1 0',
                  minWidth: 0,
                  maxWidth: 140,
                  padding: '7px 10px',
                  fontFamily: '"Rubik Mono One", monospace',
                  fontSize: 10,
                  letterSpacing: '0.06em',
                  color: snakeActive ? '#0a3d1f' : hasSnake ? '#fff' : 'rgba(255,255,255,0.25)',
                  background: snakeActive
                    ? 'linear-gradient(135deg, #aaffcc, #22d65f)'
                    : hasSnake
                    ? 'linear-gradient(135deg, #22d65f, #00ffc2)'
                    : 'rgba(255,255,255,0.04)',
                  border: `1.5px solid ${snakeActive ? '#aaffcc' : hasSnake ? 'rgba(34,214,95,0.6)' : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: 100,
                  cursor: hasSnake && !snakeActive ? 'pointer' : 'default',
                  transition: 'all 200ms',
                  boxShadow: snakeActive
                    ? '0 0 22px rgba(34,214,95,0.8), 0 0 38px rgba(0,255,194,0.5)'
                    : snakeEmergency
                    ? '0 0 22px rgba(34,214,95,0.8)'
                    : hasSnake
                    ? '0 0 10px rgba(34,214,95,0.35)'
                    : 'none',
                  animation: snakeActive
                    ? 'snakeHudGlow 600ms ease-in-out infinite'
                    : snakeEmergency
                    ? 'emergencyPulse 600ms ease-in-out infinite'
                    : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 5,
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                }}
              >
                <span style={{ fontSize: 14 }}>🐍</span>
                {snakeActive && <span style={{ fontSize: 10, fontWeight: 700 }}>LIVE</span>}
                {/* Always render the charges badge (hidden while active) so
                    the button width stays constant across state changes. */}
                <span style={{
                  padding: '2px 6px',
                  background: hasSnake ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.08)',
                  borderRadius: 100,
                  fontSize: 11,
                  fontWeight: 700,
                  visibility: snakeActive ? 'hidden' : 'visible',
                }}>
                  {snakeCharges}
                </span>
              </button>
            );
          })()}

          {/* POWER PLACER button */}
          {(() => {
            const hasPP = powerPlacerCharges > 0;
            const ppEmergency = danger && hasPP && !powerPlacerPending && !overdriveActive;
            return (
              <div style={{ position: 'relative', flex: '1 1 0', minWidth: 0, maxWidth: 140 }}>
                {ppEmergency && (
                  <div style={{
                    position: 'absolute',
                    bottom: 'calc(100% + 6px)',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    padding: '4px 10px',
                    background: 'rgba(255,123,46,0.2)',
                    border: '1px solid rgba(255,214,10,0.8)',
                    borderRadius: 100,
                    fontFamily: '"Rubik Mono One", monospace',
                    fontSize: 10,
                    color: '#ffd60a',
                    letterSpacing: '0.15em',
                    whiteSpace: 'nowrap',
                    animation: 'emergencyHint 600ms ease-in-out infinite',
                    boxShadow: '0 0 14px rgba(255,214,10,0.5)',
                    pointerEvents: 'none',
                    zIndex: 5,
                  }}>
                    BLAST IT! ↓
                  </div>
                )}
                <button
                  onClick={activatePowerPlacer}
                  disabled={!hasPP || powerPlacerPending || gameOver}
                  style={{
                    width: '100%',
                    padding: '7px 10px',
                    fontFamily: '"Rubik Mono One", monospace',
                    fontSize: 10,
                    letterSpacing: '0.06em',
                    color: powerPlacerPending
                      ? '#0a0818'
                      : hasPP
                      ? '#fff'
                      : 'rgba(255,255,255,0.25)',
                    background: powerPlacerPending
                      ? 'linear-gradient(135deg, #ffd60a, #ff7b2e)'
                      : hasPP
                      ? 'linear-gradient(135deg, #ff7b2e, #ff2e6e)'
                      : 'rgba(255,255,255,0.04)',
                    border: `1.5px solid ${powerPlacerPending ? '#ffd60a' : hasPP ? 'rgba(255,123,46,0.6)' : 'rgba(255,255,255,0.08)'}`,
                    borderRadius: 100,
                    cursor: hasPP && !powerPlacerPending ? 'pointer' : 'default',
                    transition: 'all 200ms',
                    boxShadow: powerPlacerPending
                      ? '0 0 24px rgba(255,214,10,0.7), 0 0 10px rgba(255,123,46,0.5)'
                      : ppEmergency
                      ? '0 0 24px rgba(255,214,10,0.7), 0 0 40px rgba(255,123,46,0.5)'
                      : hasPP
                      ? '0 0 10px rgba(255,123,46,0.3)'
                      : 'none',
                    animation: powerPlacerPending
                      ? 'multiplierPulse 450ms ease-in-out infinite'
                      : ppEmergency
                      ? 'emergencyPulse 500ms ease-in-out infinite'
                      : 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 5,
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ fontSize: 14 }}>💥</span>
                  {powerPlacerPending && <span style={{ fontSize: 10, fontWeight: 700 }}>ARMED</span>}
                  {!powerPlacerPending && (
                    <span style={{
                      padding: '2px 6px',
                      background: hasPP ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.08)',
                      borderRadius: 100,
                      fontSize: 11,
                    }}>
                      {powerPlacerCharges}
                    </span>
                  )}
                </button>
              </div>
            );
          })()}

          <button
            onClick={togglePause}
            disabled={gameOver}
            style={{
              order: 11,
              padding: '7px 12px',
              fontFamily: '"Rubik", sans-serif',
              fontSize: 10,
              letterSpacing: '0.15em',
              fontWeight: 700,
              color: paused ? '#ffd60a' : 'rgba(255,255,255,0.6)',
              background: paused ? 'rgba(255,214,10,0.12)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${paused ? 'rgba(255,214,10,0.4)' : 'rgba(255,255,255,0.08)'}`,
              borderRadius: 100,
              cursor: gameOver ? 'default' : 'pointer',
              transition: 'all 200ms',
              opacity: gameOver ? 0.4 : 1,
            }}
          >
            {paused ? '▶ RESUME' : '⏸ PAUSE'}
          </button>

          <button
            onClick={reset}
            style={{
              order: 12,
              padding: '7px 16px',
              fontFamily: '"Rubik", sans-serif',
              fontSize: 10,
              letterSpacing: '0.2em',
              fontWeight: 700,
              color: 'rgba(255,255,255,0.6)',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 100,
              cursor: 'pointer',
            }}
          >
            NEW GAME
          </button>
        </div>
      </div>

      {drag && drag.moved && (
        <div style={{
          position: 'fixed',
          left: drag.pLeft,
          top: drag.pTop,
          width: drag.pW,
          height: drag.pH,
          pointerEvents: 'none',
          zIndex: 50,
          opacity: overdriveActive ? 0.4 : 1,
          filter: powerPlacerPending
            ? `drop-shadow(0 0 16px #ffd60a) drop-shadow(0 8px 20px #ff2e6ecc)`
            : `drop-shadow(0 10px 20px ${drag.piece.color.main}aa)`,
          transition: 'opacity 200ms',
        }}>
          {drag.piece.cells.map(([r, c], i) => (
            <div key={i} style={{
              position: 'absolute',
              top: r * boardCell,
              left: c * boardCell,
              padding: 1,
            }}>
              <Block
                color={powerPlacerPending
                  ? { main: '#ff7b2e', light: '#ffd60a', dark: '#a30d43' }
                  : drag.piece.color}
                size={boardCell - 2}
                diamond={drag.piece.diamondAt === i ? 2 : undefined}
              />
            </div>
          ))}
        </div>
      )}

      {particles.map(p => (
        <div
          key={p.id}
          style={{
            position: 'fixed',
            left: p.x - p.size / 2,
            top: p.y - p.size / 2,
            width: p.size,
            height: p.size,
            background: p.color,
            borderRadius: '30%',
            boxShadow: `0 0 ${p.size * 2}px ${p.color}`,
            pointerEvents: 'none',
            zIndex: 40,
            ['--dx']: `${p.dx}px`,
            ['--dy']: `${p.dy}px`,
            ['--rot']: `${p.rot}deg`,
            animation: 'particleFly 900ms cubic-bezier(.2,.6,.4,1) forwards',
          }}
        />
      ))}

      {paused && !gameOver && (
        <div
          onClick={togglePause}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(5,4,16,0.78)',
            backdropFilter: 'blur(8px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 14,
            zIndex: 90,
            padding: 20,
            cursor: 'pointer',
          }}>
          <div style={{
            fontFamily: '"Rubik Mono One", monospace',
            fontSize: 44,
            letterSpacing: '0.3em',
            background: 'linear-gradient(135deg, #ffd60a, #ff7b2e)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}>PAUSED</div>
          <div style={{
            fontSize: 11,
            letterSpacing: '0.3em',
            color: 'rgba(255,255,255,0.45)',
            fontFamily: '"Rubik Mono One", monospace',
          }}>TAP TO RESUME</div>
        </div>
      )}

      {gameOver && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(5,4,16,0.88)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 18,
          zIndex: 100,
          padding: 20,
        }}>
          <div style={{
            fontFamily: '"Rubik Mono One", monospace',
            fontSize: 42,
            background: 'linear-gradient(135deg, #ff2e6e, #a855f7)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
            letterSpacing: '-0.02em',
          }}>GAME OVER</div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 10, letterSpacing: '0.3em', color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>FINAL SCORE</div>
            <div style={{ fontFamily: '"Rubik Mono One", monospace', fontSize: 60, color: '#fff', lineHeight: 1 }}>
              {score.toString().padStart(4, '0')}
            </div>
            {score > 0 && score >= best && (
              <div style={{ fontSize: 11, letterSpacing: '0.3em', color: '#ffd60a', fontWeight: 800, marginTop: 8, textShadow: '0 0 12px #ffd60a88' }}>
                ★ NEW BEST
              </div>
            )}
          </div>
          <div style={{
            display: 'flex',
            gap: 20,
            padding: '12px 20px',
            background: 'rgba(255,255,255,0.04)',
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.06)',
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 9, letterSpacing: '0.25em', color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>LEVEL</div>
              <div style={{ fontFamily: '"Rubik Mono One", monospace', fontSize: 20, color: '#cb91fb' }}>{level}</div>
            </div>
            <div style={{ width: 1, background: 'rgba(255,255,255,0.08)' }} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 9, letterSpacing: '0.25em', color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>CLEARS</div>
              <div style={{ fontFamily: '"Rubik Mono One", monospace', fontSize: 20, color: '#7aeaff' }}>{clearCount}</div>
            </div>
            <div style={{ width: 1, background: 'rgba(255,255,255,0.08)' }} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 9, letterSpacing: '0.25em', color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>EARNED</div>
              <div style={{ fontFamily: '"Rubik Mono One", monospace', fontSize: 20, color: '#ffd60a', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                <span>◉</span><span>{coinsEarnedThisGame + Math.floor(score / 100)}</span>
              </div>
            </div>
          </div>

          {/* CONTINUE — pay coins to resurrect with a free Overdrive */}
          {canContinue && (
            <button
              onClick={continueGame}
              style={{
                padding: '14px 28px',
                fontFamily: '"Rubik Mono One", monospace',
                fontSize: 14,
                letterSpacing: '0.15em',
                color: '#0a0818',
                background: 'linear-gradient(135deg, #ffd60a, #ff7b2e)',
                border: 'none',
                borderRadius: 100,
                cursor: 'pointer',
                boxShadow: '0 0 28px rgba(255,214,10,0.6), 0 6px 18px rgba(255,123,46,0.4)',
                animation: 'menuPulse 1.4s ease-in-out infinite',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <span style={{ fontSize: 16 }}>⚡</span>
              <span>CONTINUE</span>
              <span style={{
                padding: '2px 8px',
                background: 'rgba(0,0,0,0.25)',
                borderRadius: 100,
                fontSize: 11,
                display: 'flex', alignItems: 'center', gap: 4,
              }}><span>◉</span><span>{CONTINUE_COST}</span></span>
            </button>
          )}
          {usedContinue && (
            <div style={{ fontSize: 10, letterSpacing: '0.25em', color: 'rgba(255,255,255,0.3)', fontWeight: 600 }}>
              CONTINUE USED
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              onClick={reset}
              style={{
                padding: '14px 28px',
                fontFamily: '"Rubik", sans-serif',
                fontSize: 12,
                letterSpacing: '0.25em',
                fontWeight: 800,
                color: '#fff',
                background: 'linear-gradient(135deg, #a855f7, #ff2e6e)',
                border: 'none',
                borderRadius: 100,
                cursor: 'pointer',
                boxShadow: '0 8px 24px rgba(168,85,247,0.5)',
              }}
            >
              PLAY AGAIN
            </button>
            <button
              onClick={() => { reset(); setScreen('menu'); }}
              style={{
                padding: '14px 22px',
                fontFamily: '"Rubik", sans-serif',
                fontSize: 12,
                letterSpacing: '0.25em',
                fontWeight: 700,
                color: 'rgba(255,255,255,0.7)',
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: 100,
                cursor: 'pointer',
              }}
            >
              MENU
            </button>
            <button
              onClick={() => setScreen('shop')}
              style={{
                padding: '14px 22px',
                fontFamily: '"Rubik", sans-serif',
                fontSize: 12,
                letterSpacing: '0.25em',
                fontWeight: 700,
                color: '#ffd60a',
                background: 'rgba(255,214,10,0.08)',
                border: '1px solid rgba(255,214,10,0.35)',
                borderRadius: 100,
                cursor: 'pointer',
              }}
            >
              🛒 SHOP
            </button>
          </div>
        </div>
      )}

      {/* Flying coin particles — visual feedback on earn */}
      {flyingCoins.map(c => (
        <div key={c.id} style={{
          position: 'fixed',
          left: c.x,
          top: c.y,
          fontFamily: '"Rubik Mono One", monospace',
          fontSize: 22,
          color: '#ffd60a',
          textShadow: '0 0 16px #ffd60a, 0 0 28px rgba(255,123,46,0.6)',
          animation: 'coinFly 950ms cubic-bezier(.4,0,.2,1) forwards',
          pointerEvents: 'none',
          zIndex: 150,
          transform: 'translate(-50%, -50%)',
          willChange: 'transform, opacity',
        }}>◉</div>
      ))}

      {/* CELEBRATION banner — MEGA CASCADE / PERFECT / LEVEL UP / MILESTONES */}
      {celebration && (
        <div
          key={celebration.id}
          style={{
            position: 'fixed',
            inset: 0,
            display: 'grid',
            placeItems: 'center',
            pointerEvents: 'none',
            zIndex: 200,
          }}
        >
          {/* Screen flash backdrop */}
          <div style={{
            position: 'absolute',
            inset: 0,
            background: celebration.type === 'perfect'
              ? 'radial-gradient(ellipse at center, rgba(255,255,255,0.25), rgba(0,212,255,0.15) 40%, transparent 70%)'
              : celebration.type === 'mega'
              ? 'radial-gradient(ellipse at center, rgba(255,46,110,0.3), rgba(255,123,46,0.18) 45%, transparent 75%)'
              : celebration.type === 'level'
              ? 'radial-gradient(ellipse at center, rgba(168,85,247,0.28), rgba(0,212,255,0.15) 45%, transparent 75%)'
              : 'radial-gradient(ellipse at center, rgba(255,214,10,0.22), rgba(255,123,46,0.1) 45%, transparent 75%)',
            animation: 'megaFlash 600ms ease-out',
          }} />

          <div style={{
            position: 'relative',
            padding: '20px 36px',
            textAlign: 'center',
            animation: 'celebrationIn 400ms cubic-bezier(.3,1.6,.5,1), celebrationFadeOut 500ms ease 1900ms forwards',
          }}>
            <div style={{
              fontFamily: '"Rubik Mono One", monospace',
              fontSize: celebration.type === 'mega' || celebration.type === 'perfect' ? 56 : 44,
              letterSpacing: '-0.02em',
              lineHeight: 0.95,
              background: celebration.type === 'perfect'
                ? 'linear-gradient(135deg, #ffffff 0%, #00d4ff 50%, #a855f7 100%)'
                : celebration.type === 'mega'
                ? 'linear-gradient(135deg, #ffd60a 0%, #ff7b2e 50%, #ff2e6e 100%)'
                : celebration.type === 'level'
                ? 'linear-gradient(135deg, #00d4ff 0%, #a855f7 50%, #ff2e6e 100%)'
                : 'linear-gradient(135deg, #ffd60a 0%, #ff7b2e 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              animation: 'celebrationPulse 700ms ease-in-out infinite',
            }}>
              {celebration.title}
            </div>
            <div style={{
              fontFamily: '"Rubik Mono One", monospace',
              fontSize: 13,
              letterSpacing: '0.35em',
              color: 'rgba(255,255,255,0.9)',
              marginTop: 14,
              textShadow: '0 0 18px rgba(0,212,255,0.6)',
            }}>
              {celebration.subtext}
            </div>
            {celebration.bonus != null && celebration.bonus > 0 && (
              <div style={{
                marginTop: 16,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 18px',
                background: 'rgba(255,214,10,0.15)',
                border: '1px solid rgba(255,214,10,0.5)',
                borderRadius: 100,
                fontFamily: '"Rubik Mono One", monospace',
                fontSize: 20,
                color: '#ffd60a',
                textShadow: '0 0 18px #ffd60a',
                boxShadow: '0 0 30px rgba(255,214,10,0.5)',
              }}>
                <span>◉</span>
                <span>+{celebration.bonus}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
