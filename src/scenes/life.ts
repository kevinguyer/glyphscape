import { clamp, hsv, type RGB } from '../engine/math';
import type { SceneDef } from '../engine/types';

const cp = (c: string) => c.codePointAt(0)!;
const AGE_GLYPHS = ['·', 'o', 'O', '0', '@'].map(cp);

const PATTERNS = {
  rpent: ['.##', '##.', '.#.'],
  glider: ['.#.', '..#', '###'],
  lwss: ['.#..#', '#....', '#...#', '####.'],
  acorn: ['.#.....', '...#...', '##..###'],
};

/** Conway-style cellular automata with age-based glyphs and gentle reseeding. */
const life: SceneDef = {
  id: 'life',
  name: 'Life Garden',
  family: 'simulation',
  blurb: 'Cellular automata that age, fade and reseed',
  recommended: { style: 'green-phosphor', colorMode: 'native' },
  defaultSeed: 1970,
  params: [
    { key: 'speed', label: 'Generations/s', min: 1, max: 15, default: 5 },
    { key: 'reseed', label: 'Reseeding', min: 0, max: 1, default: 0.5 },
    { key: 'trails', label: 'Trails', min: 0, max: 1, default: 0.6 },
  ],
  create() {
    let cols = 0, rows = 0, n = 0;
    let alive = new Uint8Array(0), next = new Uint8Array(0);
    let age = new Uint16Array(0);
    let ghost = new Float32Array(0), disp = new Float32Array(0);
    let acc = 0, sinceSeed = 0, sinceBeat = 10;
    const popHist: number[] = [];
    const rgb: RGB = [0, 0, 0];
    let rng: () => number = Math.random;

    const stamp = (pat: string[], x0: number, y0: number, flipX = false, flipY = false) => {
      for (let y = 0; y < pat.length; y++) {
        for (let x = 0; x < pat[y].length; x++) {
          if (pat[y][x] !== '#') continue;
          const xx = ((flipX ? x0 - x : x0 + x) % cols + cols) % cols;
          const yy = ((flipY ? y0 - y : y0 + y) % rows + rows) % rows;
          const i = yy * cols + xx;
          if (!alive[i]) { alive[i] = 1; age[i] = 0; }
        }
      }
    };

    const soup = (cx: number, cy: number, r: number, density: number) => {
      for (let y = -r; y <= r; y++) {
        for (let x = -r * 2; x <= r * 2; x++) {
          if (rng() > density) continue;
          const xx = ((cx + x) % cols + cols) % cols, yy = ((cy + y) % rows + rows) % rows;
          const i = yy * cols + xx;
          if (!alive[i]) { alive[i] = 1; age[i] = 0; }
        }
      }
    };

    const step = () => {
      let pop = 0;
      for (let y = 0; y < rows; y++) {
        const ym = ((y - 1 + rows) % rows) * cols, y0 = y * cols, yp = ((y + 1) % rows) * cols;
        for (let x = 0; x < cols; x++) {
          const xm = x === 0 ? cols - 1 : x - 1, xp = x === cols - 1 ? 0 : x + 1;
          const s = alive[ym + xm] + alive[ym + x] + alive[ym + xp] + alive[y0 + xm] + alive[y0 + xp] + alive[yp + xm] + alive[yp + x] + alive[yp + xp];
          const i = y0 + x;
          const a = alive[i];
          const live = a ? s === 2 || s === 3 : s === 3;
          next[i] = live ? 1 : 0;
          if (live) {
            age[i] = a ? Math.min(65535, age[i] + 1) : 0;
            pop++;
          } else if (a) {
            ghost[i] = 1;
          }
        }
      }
      const tmp = alive; alive = next; next = tmp;
      return pop;
    };

    return {
      init(ctx) {
        cols = ctx.cols; rows = ctx.rows; n = cols * rows;
        alive = new Uint8Array(n); next = new Uint8Array(n); age = new Uint16Array(n);
        ghost = new Float32Array(n); disp = new Float32Array(n);
        rng = ctx.rng;
        const patches = Math.max(4, Math.floor(n / 900));
        for (let k = 0; k < patches; k++) soup(ctx.rng.int(0, cols), ctx.rng.int(0, rows), ctx.rng.int(3, 8), 0.38);
        popHist.length = 0;
      },
      update(dt, audio, ctx) {
        acc += dt * ctx.params.speed;
        sinceSeed += dt;
        sinceBeat += dt;
        if (audio.beat > 0.75 && sinceBeat > 1) {
          sinceBeat = 0;
          stamp(PATTERNS.rpent, ctx.rng.int(0, cols), ctx.rng.int(0, rows));
        }
        const trailDecay = 0.55 + ctx.params.trails * 0.4;
        while (acc >= 1) {
          acc -= 1;
          for (let i = 0; i < n; i++) ghost[i] *= trailDecay;
          const pop = step();
          popHist.push(pop);
          if (popHist.length > 60) popHist.shift();
          // Gentle reseeding when the garden dies down or settles into still life.
          const settled = popHist.length >= 60 && Math.max(...popHist) - Math.min(...popHist) <= 6;
          const sparse = pop < n * 0.015;
          const interval = 50 - ctx.params.reseed * 35;
          if (ctx.params.reseed > 0 && ((settled || sparse) && sinceSeed > 8 || sinceSeed > interval)) {
            sinceSeed = 0;
            const k = settled || sparse ? 2 + ctx.rng.int(0, 3) : 1;
            for (let j = 0; j < k; j++) soup(ctx.rng.int(0, cols), ctx.rng.int(0, rows), ctx.rng.int(3, 7), 0.35);
            if (settled) popHist.length = 0;
          }
        }
        // ease displayed brightness toward the state so births and deaths fade
        const k = Math.min(1, dt * 7);
        for (let i = 0; i < n; i++) {
          const target = alive[i] ? 0.55 + 0.45 * Math.min(1, age[i] / 30) : ghost[i] * 0.35;
          disp[i] += (target - disp[i]) * k;
        }
      },
      event(ctx) {
        // A flotilla sails in from one corner.
        const fx = ctx.rng() < 0.5, fy = ctx.rng() < 0.5;
        const x0 = fx ? cols - 5 : 5, y0 = fy ? rows - 5 : 5;
        for (let k = 0; k < 4; k++) stamp(PATTERNS.glider, x0 + (fx ? -k * 6 : k * 6), y0 + (fy ? -k * 3 : k * 3), fx, fy);
        stamp(PATTERNS.acorn, Math.floor(cols / 2), Math.floor(rows / 2));
      },
      render(grid) {
        const V = grid.v, C = grid.col, G = grid.glyph;
        for (let i = 0; i < n; i++) {
          const d = disp[i];
          if (d < 0.01) continue;
          V[i] = clamp(d);
          const c = i * 3;
          if (alive[i]) {
            const a = age[i];
            G[i] = AGE_GLYPHS[a < 1 ? 0 : a < 4 ? 1 : a < 16 ? 2 : a < 60 ? 3 : 4];
            hsv(0.5 - Math.min(1, a / 80) * 0.38, 0.55 + Math.min(0.3, a / 200), 1, rgb);
          } else {
            G[i] = AGE_GLYPHS[0];
            hsv(0.55, 0.4, 0.8, rgb);
          }
          C[c] = rgb[0]; C[c + 1] = rgb[1]; C[c + 2] = rgb[2];
        }
      },
    };
  },
};

export default life;
