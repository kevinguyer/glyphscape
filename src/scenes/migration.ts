import type { Grid } from '../engine/grid';
import { clamp, smoothstep } from '../engine/math';
import type { Rng } from '../engine/rng';
import type { SceneDef } from '../engine/types';
import { cp, drawJelly, Motes, swimJelly, type Jelly, type JellyKind } from './kit';

type RGB = [number, number, number];
const BELL_COLORS: RGB[] = [[1, 0.55, 0.85], [0.45, 0.9, 1], [0.75, 0.6, 1], [0.7, 0.95, 1], [1, 0.8, 0.55]];

// Three depths for parallax: far ones are small, dim and slow; near ones large and bright.
const LAYERS = [
  { scale: 0.45, fade: 0.35, speed: 0.55, count: 9 },
  { scale: 0.75, fade: 0.65, speed: 0.8, count: 6 },
  { scale: 1.15, fade: 1, speed: 1, count: 3 },
];

interface Swimmer { j: Jelly; layer: number }

/**
 * Diel vertical migration: at nightfall, multitudes of jellies rise from the deep together.
 * Bells, moon jellies and rainbow comb jellies drift upward in three layers of depth, a long
 * siphonophore chain ripples with light, and marine snow falls past them all.
 */
const migration: SceneDef = {
  id: 'migration',
  name: 'Jellyfish Migration',
  family: 'particle',
  blurb: 'A procession of glowing jellies rising from the deep',
  recommended: { style: 'midnight' },
  defaultSeed: 3303,
  params: [
    { key: 'density', label: 'Density', min: 0.2, max: 1.5, default: 0.8 },
    { key: 'climb', label: 'Climb', min: 0, max: 2, default: 0.8 },
    { key: 'current', label: 'Current', min: 0, max: 2, default: 0.5 },
    { key: 'glow', label: 'Glow', min: 0.2, max: 1.5, default: 1 },
  ],
  create() {
    let cols = 0, rows = 0, aspect = 0.6, t = 0, kick = 0;
    let rng!: Rng;
    let swimmers: Swimmer[] = [];
    let byLayer: Swimmer[][] = [];
    const snow = new Motes();
    let chainX = 0, chainY = 0, chainLen = 0;
    let giant: Jelly | null = null;

    const spawn = (layer: number, anywhere: boolean): Swimmer => {
      const L = LAYERS[layer];
      const r = rng();
      const kind: JellyKind = r < 0.45 ? 'bell' : r < 0.75 ? 'moon' : 'comb';
      const size = Math.max(1.2, rows * rng.range(0.035, 0.06) * L.scale);
      return {
        layer,
        j: {
          kind, size,
          x: rng() * cols,
          y: anywhere ? rng() * rows : rows + size * 3 + rng() * rows * 0.3,
          phase: rng() * 5, period: rng.range(2.8, 5), color: rng.pick(BELL_COLORS), drift: rng.range(-0.4, 0.4),
        },
      };
    };

    return {
      init(ctx) {
        cols = ctx.cols; rows = ctx.rows; aspect = ctx.aspect; rng = ctx.rng;
        swimmers = [];
        const widthScale = Math.max(0.5, cols / 120);
        LAYERS.forEach((L, li) => {
          for (let k = 0; k < Math.round(L.count * widthScale * 1.5); k++) swimmers.push(spawn(li, true));
        });
        byLayer = LAYERS.map((_, li) => swimmers.filter((s) => s.layer === li));
        snow.init(rng, cols, rows, Math.floor((cols * rows) / 45));
        chainX = cols * rng.range(0.2, 0.8);
        chainY = rows * rng.range(0.2, 0.8);
        chainLen = Math.round(rows * 0.45);
        giant = null;
        t = rng() * 100;
      },
      update(dt, audio, ctx) {
        t += dt;
        kick = Math.max(kick * Math.exp(-dt * 2), audio.bands[0]);
        const climb = ctx.params.climb, cur = ctx.params.current;
        for (const s of swimmers) {
          const L = LAYERS[s.layer];
          swimJelly(s.j, dt * L.speed, { kick, current: cur, climb, t });
          s.j.x += cur * 0.6 * L.speed * dt; // the whole procession drifts with the current
          if (s.j.x > cols + 8) s.j.x -= cols + 16;
          if (s.j.x < -8) s.j.x += cols + 16;
          // once a jelly rises out of view, a new one enters from the deep
          if (s.j.y < -s.j.size * 6) Object.assign(s, spawn(s.layer, false));
        }
        snow.update(dt, ctx.noise, t, { drift: 0.3 + cur * 0.3, rise: 0.6 });
        // the siphonophore rises slowly and wraps
        chainY -= dt * (0.4 + climb * 0.5);
        chainX += cur * 0.4 * dt;
        if (chainY < -chainLen) { chainY = rows + 2; chainX = cols * rng.range(0.15, 0.85); }
        if (chainX > cols + 5) chainX -= cols + 10;
        if (giant) {
          swimJelly(giant, dt * 0.6, { kick, current: cur, climb: climb * 0.5, t });
          if (giant.y < -giant.size * 8) giant = null;
        }
      },
      event() {
        // A giant drifts up through the near layer, trailing tentacles far below it.
        giant = {
          kind: 'bell', x: cols * rng.range(0.3, 0.7), y: rows * 1.25, size: rows * 0.13,
          phase: 0, period: 7, color: [1, 0.6, 0.45], drift: rng.range(-0.3, 0.3),
        };
      },
      render(grid, ctx) {
        const V = grid.v, C = grid.col;
        const glow = ctx.params.glow;
        // the water: black in the deep, the faintest blue far above, a few dim shafts of light
        for (let y = 0; y < rows; y++) {
          const up = 1 - y / rows;
          for (let x = 0; x < cols; x++) {
            const i = y * cols + x;
            const shaft = smoothstep(0.45, 0.85, ctx.noise.n2(x * aspect * 0.03 + y * 0.01 - t * 0.01, 7));
            V[i] = 0.006 + 0.03 * up * up * up + shaft * 0.02 * up * up;
            C[i * 3] = 0.15; C[i * 3 + 1] = 0.35; C[i * 3 + 2] = 0.65;
          }
        }
        snow.render(grid, t, 0.12, [0.75, 0.82, 0.9], [0.9, 1, 1]);
        const density = ctx.params.density;
        // far layers first; draw only as many of each layer as the density asks for
        for (let li = 0; li < LAYERS.length; li++) {
          const layer = byLayer[li];
          const n = Math.round(layer.length * clamp(density / 1.5));
          for (let k = 0; k < n; k++) drawJelly(grid, layer[k].j, t, aspect, glow, LAYERS[li].fade);
          if (li === 1) drawSiphonophore(grid, chainX, chainY, chainLen, t, aspect, glow * 0.8);
        }
        if (giant) drawJelly(grid, giant, t, aspect, glow * clamp((rows * 1.2 - giant.y) / (rows * 0.3)));
      },
    };
  },
};

/** A siphonophore: a long colonial chain of glowing beads, with a wave of light running down it. */
function drawSiphonophore(grid: Grid, x0: number, y0: number, len: number, t: number, aspect: number, glow: number) {
  for (let k = 0; k < len; k++) {
    const f = k / len;
    const x = x0 + Math.sin(t * 0.35 + k * 0.18) * (1 + 4 * f) / aspect * 0.6;
    const y = y0 + k * 0.9;
    const wave = 0.5 + 0.5 * Math.sin(k * 0.45 - t * 2.2);
    const bead = k % 3 === 0;
    grid.max(x, y, clamp((bead ? 0.25 + 0.45 * wave : 0.12 + 0.15 * wave) * glow * (1 - f * 0.4)),
      0.55 + 0.4 * wave, 0.9, 1, cp(k === 0 ? '@' : bead ? 'o' : ':'));
  }
}

export default migration;
