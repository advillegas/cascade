import { useState, useEffect, useRef, useCallback, useMemo } from 'react';

const GRID = 8;

const SHAPES = [
  [[0,0]],
  [[0,0],[1,1]], [[0,1],[1,0]],
  [[0,0],[0,1]], [[0,0],[1,0]],
  [[0,0],[0,1],[0,2]], [[0,0],[1,0],[2,0]],
  [[0,0],[0,1],[0,2],[0,3]], [[0,0],[1,0],[2,0],[3,0]],
  [[0,0],[0,1],[0,2],[0,3],[0,4]], [[0,0],[1,0],[2,0],[3,0],[4,0]],
  [[0,0],[0,1],[1,0],[1,1]],
  [[0,0],[0,1],[0,2],[1,0],[1,1],[1,2],[2,0],[2,1],[2,2]],
  [[0,0],[1,0],[1,1]], [[0,0],[0,1],[1,0]],
  [[0,0],[0,1],[1,1]], [[0,1],[1,0],[1,1]],
  [[0,0],[1,0],[2,0],[2,1],[2,2]],
  [[0,0],[0,1],[0,2],[1,2],[2,2]],
  [[0,0],[0,1],[0,2],[1,0],[2,0]],
  [[0,2],[1,2],[2,0],[2,1],[2,2]],
  [[0,0],[0,1],[0,2],[1,1]],
  [[0,1],[1,0],[1,1],[1,2]],
  [[0,0],[1,0],[1,1],[2,0]],
  [[0,1],[1,0],[1,1],[2,1]],
  [[0,1],[0,2],[1,0],[1,1]],
  [[0,0],[0,1],[1,1],[1,2]],
];

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

const rand = () => Math.random().toString(36).slice(2, 9);
const makePiece = () => ({
  id: rand(),
  cells: SHAPES[Math.floor(Math.random() * SHAPES.length)],
  color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
});
const newTray = () => [makePiece(), makePiece(), makePiece()];
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

function Block({ color, size, clearing, ghost, fresh, powerup }) {
  const c = color;
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        background: ghost
          ? `linear-gradient(135deg, ${c.light}55, ${c.main}44)`
          : `linear-gradient(135deg, ${c.light} 0%, ${c.main} 55%, ${c.dark} 100%)`,
        borderRadius: size * 0.18,
        boxShadow: ghost
          ? `inset 0 0 0 2px ${c.main}99`
          : `inset ${size*0.08}px ${size*0.08}px 0 rgba(255,255,255,0.3),
             inset -${size*0.06}px -${size*0.06}px 0 rgba(0,0,0,0.28),
             0 ${size*0.05}px ${size*0.12}px rgba(0,0,0,0.4)${powerup ? `, 0 0 ${size*0.5}px ${powerup.color}cc` : ''}`,
        opacity: ghost ? 0.55 : 1,
        transform: clearing ? 'scale(0) rotate(180deg)' : 'scale(1) rotate(0)',
        transition: clearing ? 'transform 400ms cubic-bezier(.5,-0.3,.3,1.5), opacity 350ms' : 'transform 200ms',
        animation: fresh ? 'blockSpawn 320ms cubic-bezier(.3,1.6,.5,1) both' : 'none',
      }}
    >
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
  const cell = Math.min(slotSize / (maxDim + 0.5), 22);
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
            <Block color={piece.color} size={cell - cell * 0.12} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  const [board, setBoard] = useState(emptyBoard);
  const [tray, setTray] = useState(newTray);
  const [trayKey, setTrayKey] = useState(0);
  const [score, setScore] = useState(0);
  const [displayScore, setDisplayScore] = useState(0);
  const [best, setBest] = useState(0);
  const [streak, setStreak] = useState(0);
  const [clearCount, setClearCount] = useState(0);
  const [clearing, setClearing] = useState({ rows: [], cols: [] });
  const [gameOver, setGameOver] = useState(false);
  const [drag, setDrag] = useState(null);
  const [preview, setPreview] = useState(null);
  const [toast, setToast] = useState(null);
  const [boardCell, setBoardCell] = useState(40);
  const [popups, setPopups] = useState([]);
  const [particles, setParticles] = useState([]);
  const [freshCells, setFreshCells] = useState(new Set());
  const [muted, setMuted] = useState(true);
  const [shakeKey, setShakeKey] = useState(0);
  const [shakeLevel, setShakeLevel] = useState(1);

  // OVERDRIVE: a limited-charge powerup the player activates on demand.
  // Grants 10 seconds where every dragged piece snaps to the optimal placement.
  const [overdriveCharges, setOverdriveCharges] = useState(2);
  const [overdriveEndsAt, setOverdriveEndsAt] = useState(null);
  const [nowTick, setNowTick] = useState(Date.now());

  // POWER PLACER: single-use charge that flood-fills the entire connected
  // cluster when the next piece is placed. Earned randomly every 10–30 points.
  const [powerPlacerCharges, setPowerPlacerCharges] = useState(0);
  const [powerPlacerPending, setPowerPlacerPending] = useState(false);
  const [nextPowerupScore, setNextPowerupScore] = useState(() =>
    10 + Math.floor(Math.random() * 21)
  );

  const boardRef = useRef(null);
  const audioRef = useRef(null);
  const shakeRef = useRef(null);
  const musicRef = useRef({ timer: null, step: 0 });
  const dangerRef = useRef(false);
  const tensionRef = useRef(0);
  const mutedRef = useRef(true);

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
    setTray(newTray());
    setTrayKey(k => k + 1);
    setScore(0);
    setDisplayScore(0);
    setStreak(0);
    setClearCount(0);
    setClearing({ rows: [], cols: [] });
    setGameOver(false);
    setToast(null);
    setPopups([]);
    setParticles([]);
    setFreshCells(new Set());
    setOverdriveCharges(2);
    setOverdriveEndsAt(null);
    setPowerPlacerCharges(0);
    setPowerPlacerPending(false);
    setNextPowerupScore(10 + Math.floor(Math.random() * 21));
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

  // DANGER: at least one placement the player could make right now would leave
  // NO remaining tray piece able to fit anywhere (immediate game over on next placement)
  // Suppressed during overdrive since placement is always possible then.
  const danger = useMemo(() => {
    if (gameOver || overdriveActive) return false;
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
  }, [board, tray, gameOver, overdriveActive, canPlace, canFit]);

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
    cells.forEach(([r, c], i) => {
      next[r][c] = {
        color: piece.color,
        powerup: i === powerupIdx ? chosenPowerup : null,
      };
      placedKeys.push(`${r},${c}`);
    });

    // Detect cleared rows/columns
    const rc = [], cc = [];
    for (let r = 0; r < GRID; r++) if (next[r].every(x => x)) rc.push(r);
    for (let c = 0; c < GRID; c++) if (next.every(rr => rr[c])) cc.push(c);

    // Build the mask of cells being cleared
    const clearMask = new Set();
    for (const r of rc) for (let c = 0; c < GRID; c++) clearMask.add(`${r},${c}`);
    for (const c of cc) for (let r = 0; r < GRID; r++) clearMask.add(`${r},${c}`);

    // POWER PLACER: flood-fill from the placed cells through connected blocks
    // and add them all to the clear mask (shape + connected cluster all break)
    const triggeredPowerPlacer = powerPlacerPending;
    if (triggeredPowerPlacer) {
      setPowerPlacerPending(false);
      const visited = new Set(cells.map(([r, c]) => `${r},${c}`));
      const queue = [...cells];
      while (queue.length) {
        const [r, c] = queue.shift();
        clearMask.add(`${r},${c}`);
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
      if (lines > 0) setClearCount(c => c + lines);
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
      // POWER PLACER GRANTS: every 10–30 score points
      if (ns >= nextPowerupScore) {
        setPowerPlacerCharges(c => c + 1);
        setNextPowerupScore(ns + 10 + Math.floor(Math.random() * 21));
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
      return ns;
    });
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

    const nextTrayArr = tray.map((p, i) => i === trayIndex ? null : p);
    const anyLeft = nextTrayArr.some(Boolean);
    const finalTray = anyLeft ? nextTrayArr : newTray();
    const didRefill = !anyLeft;

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
          if (cell) clearedCells.push({ r, c, color: cell.color });
        }
        addParticles(clearedCells, boardRect);
      }

      addPopup(clearPts, streakMult, lines, powerupMult > 1 ? powerupMult : null);

      setBoard(next);
      setClearing({ rows: rc, cols: cc, extra: triggeredPowerPlacer ? Array.from(clearMask) : null });
      setTimeout(() => {
        // Clear every cell in the mask (lines + power-placer flood)
        let cleared = next.map(r => [...r]);
        for (const k of clearMask) {
          const [r, c] = k.split(',').map(Number);
          cleared[r][c] = null;
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
        if (!overdriveActive && !finalTray.filter(Boolean).some(p => canFit(p, cleared))) {
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
      if (!overdriveActive && !finalTray.filter(Boolean).some(p => canFit(p, next))) {
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
      const lift = 80;
      const pW = d.cols * cs;
      const pH = d.rows * cs;
      const pLeft = e.clientX - pW / 2;
      const pTop = e.clientY - lift - pH / 2;
      setDrag(prev => ({ ...prev, x: e.clientX, y: e.clientY, pLeft, pTop, pW, pH }));

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
        const col = Math.round((pLeft - rect.left) / cs);
        const row = Math.round((pTop - rect.top) / cs);
        if (canPlace(drag.piece, row, col, board)) {
          newCells = drag.piece.cells.map(([dr, dc]) => [row + dr, col + dc]);
          meta = { row, col };
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
      if (preview && preview.cells) place(drag.trayIndex, preview.cells);
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
    if (gameOver || clearing.rows.length || clearing.cols.length || (clearing.extra && clearing.extra.length)) return;
    const piece = tray[trayIndex];
    if (!piece || !boardRef.current) return;
    initAudio();
    const rect = boardRef.current.getBoundingClientRect();
    const cs = rect.width / GRID;
    const d = dims(piece.cells);
    const lift = 80;
    const pW = d.cols * cs;
    const pH = d.rows * cs;
    const pLeft = e.clientX - pW / 2;
    const pTop = e.clientY - lift - pH / 2;
    setDrag({ piece, trayIndex, x: e.clientX, y: e.clientY, pLeft, pTop, pW, pH });
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

  return (
    <div style={{
      minHeight: '100vh',
      width: '100%',
      background: 'radial-gradient(ellipse at top, #1a1440 0%, #0a0818 55%, #050410 100%)',
      color: '#fff',
      fontFamily: '"Rubik", system-ui, sans-serif',
      touchAction: 'manipulation',
      userSelect: 'none',
      WebkitUserSelect: 'none',
      overflow: 'hidden',
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
        padding: '20px 16px 40px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 16,
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
              <span style={{
                display: 'inline-block',
                padding: '2px 6px',
                background: 'rgba(168,85,247,0.2)',
                borderRadius: 4,
                color: '#cb91fb',
                fontWeight: 700,
              }}>LVL {level}</span>
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
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
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
            {streak >= 2 && (
              <div style={{
                marginTop: 4,
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
                marginTop: 4,
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

        {/* Board */}
        <div style={{ position: 'relative', width: '100%', maxWidth: 400 }}>
          <div
            ref={boardRef}
            style={{
              width: '100%',
              aspectRatio: '1 / 1',
              display: 'grid',
              gridTemplateColumns: `repeat(${GRID}, 1fr)`,
              gridTemplateRows: `repeat(${GRID}, 1fr)`,
              gap: 3,
              padding: 8,
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
              const previewColor = drag?.piece.color;
              return (
                <div
                  key={i}
                  style={{
                    position: 'relative',
                    borderRadius: 6,
                    background: cell ? 'transparent' : 'rgba(255,255,255,0.025)',
                    boxShadow: cell ? 'none' : 'inset 0 0 0 1px rgba(255,255,255,0.02)',
                  }}
                >
                  {cell && (
                    <div style={{ position: 'absolute', inset: 0 }}>
                      <Block color={cell.color} size={boardCell - 3} clearing={isClearing} fresh={isFresh} powerup={cell.powerup} />
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
                        size={boardCell - 3}
                        ghost
                      />
                    </div>
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
          maxWidth: 400,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 10,
          padding: 12,
          background: 'rgba(255,255,255,0.02)',
          borderRadius: 14,
          border: '1px solid rgba(255,255,255,0.05)',
        }}>
          {tray.map((piece, i) => {
            const isDragging = drag?.trayIndex === i;
            return (
              <TrayPiece
                key={`${trayKey}-${i}-${piece?.id || 'empty'}`}
                piece={piece}
                faded={isDragging}
                slotSize={110}
                onPointerDown={(e) => startDrag(e, i)}
              />
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
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
              padding: '10px 14px',
              fontFamily: '"Rubik", sans-serif',
              fontSize: 11,
              letterSpacing: '0.15em',
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
              <div style={{ position: 'relative' }}>
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
                    padding: '10px 18px',
                    fontFamily: '"Rubik Mono One", monospace',
                    fontSize: 13,
                    letterSpacing: '0.1em',
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
                    minWidth: 140,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
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
                      <span>OVERDRIVE</span>
                      <span style={{
                        padding: '2px 8px',
                        background: hasCharges ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.08)',
                        borderRadius: 100,
                        fontSize: 11,
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

          {/* POWER PLACER button */}
          {(() => {
            const hasPP = powerPlacerCharges > 0;
            return (
              <button
                onClick={activatePowerPlacer}
                disabled={!hasPP || powerPlacerPending || gameOver}
                style={{
                  padding: '10px 16px',
                  fontFamily: '"Rubik Mono One", monospace',
                  fontSize: 12,
                  letterSpacing: '0.08em',
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
                    : hasPP
                    ? '0 0 10px rgba(255,123,46,0.3)'
                    : 'none',
                  animation: powerPlacerPending ? 'multiplierPulse 450ms ease-in-out infinite' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span style={{ fontSize: 13 }}>💥</span>
                <span>{powerPlacerPending ? 'ARMED' : 'POWER'}</span>
                {!powerPlacerPending && (
                  <span style={{
                    padding: '2px 8px',
                    background: hasPP ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.08)',
                    borderRadius: 100,
                    fontSize: 11,
                  }}>
                    {powerPlacerCharges}
                  </span>
                )}
              </button>
            );
          })()}

          <button
            onClick={reset}
            style={{
              padding: '10px 22px',
              fontFamily: '"Rubik", sans-serif',
              fontSize: 11,
              letterSpacing: '0.25em',
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

      {drag && (
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
              padding: 1.5,
            }}>
              <Block
                color={powerPlacerPending
                  ? { main: '#ff7b2e', light: '#ffd60a', dark: '#a30d43' }
                  : drag.piece.color}
                size={boardCell - 3}
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
          </div>
          <button
            onClick={reset}
            style={{
              padding: '14px 36px',
              fontFamily: '"Rubik", sans-serif',
              fontSize: 12,
              letterSpacing: '0.3em',
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
        </div>
      )}
    </div>
  );
}
