import { LowResField } from '../engine/field';
import { clamp, smoothstep } from '../engine/math';
import { hash2, type Rng } from '../engine/rng';
import type { SceneDef } from '../engine/types';
import { cp, lineGlyph, StarField } from './kit';

const FLASH = 1.0; // seconds a flash lasts (rise, hold, fade): about 1 Hz, gentle
const MAX_FLIES = 260;

interface Blade { x: number; y: number; h: number; lean: number; phase: number; flower: number }

/** Brightness of a flash at time `s` since it began (0 outside the flash). */
function flashShape(s: number) {
  if (s < 0 || s > FLASH) return 0;
  if (s < 0.25) return smoothstep(0, 0.25, s);
  if (s < 0.4) return 1;
  return 1 - smoothstep(0.4, FLASH, s);
}

/**
 * A summer meadow at dusk. Fireflies drift over swaying grass, each blinking in its own rhythm,
 * and their light catches the nearby blades. They are pulse-coupled oscillators: every flash
 * nudges the neighbours' clocks, so with enough coupling, waves of synchrony spread across
 * the field. Rarely the whole meadow falls into step and flashes as one.
 */
const fireflies: SceneDef = {
  id: 'fireflies',
  name: 'Firefly Meadow',
  family: 'particle',
  blurb: 'Fireflies blinking over a dusk meadow, sometimes in sync',
  recommended: { style: 'midnight' },
  defaultSeed: 1776,
  params: [
    { key: 'count', label: 'Fireflies', min: 0.1, max: 1, default: 0.55 },
    { key: 'sync', label: 'Sync', min: 0, max: 1, default: 0.2 },
    { key: 'wind', label: 'Breeze', min: 0, max: 1.5, default: 0.5 },
    { key: 'mist', label: 'Mist', min: 0, max: 1, default: 0.35 },
  ],
  create() {
    let cols = 0, rows = 0, aspect = 0.6, t = 0;
    let rng!: Rng;
    let horizon = 0;
    let trees = new Float32Array(0);
    let blades: Blade[] = [];
    const stars = new StarField();
    const mist = new LowResField(3, 4);
    // fireflies
    const fx = new Float32Array(MAX_FLIES), fy = new Float32Array(MAX_FLIES), fvx = new Float32Array(MAX_FLIES), fvy = new Float32Array(MAX_FLIES);
    const theta = new Float32Array(MAX_FLIES), period = new Float32Array(MAX_FLIES), since = new Float32Array(MAX_FLIES);
    const doubles = new Uint8Array(MAX_FLIES), seed = new Float32Array(MAX_FLIES);
    let active = 0;
    // light the fireflies cast, at half resolution
    let light = new Float32Array(0), lw = 0, lh = 0;
    let syncEvent = -1, sinceBeat = 10;

    const brightness = (k: number) => {
      const s = since[k];
      return Math.max(flashShape(s), doubles[k] ? flashShape(s - 0.65) * 0.8 : 0);
    };

    return {
      init(ctx) {
        cols = ctx.cols; rows = ctx.rows; aspect = ctx.aspect; rng = ctx.rng;
        horizon = Math.round(rows * 0.5);
        trees = new Float32Array(cols);
        for (let x = 0; x < cols; x++) {
          const u = x * aspect;
          // a soft treeline with rounded crowns
          trees[x] = horizon - rows * (0.05 + 0.06 * Math.max(0, ctx.noise.fbm2(u * 0.03, 2, 3) + 0.3) + 0.025 * Math.abs(Math.sin(u * 0.35)));
        }
        stars.init(rng, cols, rows, aspect, { density: 0.012, maxY: 0.4 });
        // grass: denser and taller toward the viewer
        blades = [];
        for (let y = horizon + 1; y < rows + 4; y++) {
          const near = (y - horizon) / (rows - horizon);
          const perRow = cols * (0.05 + 0.11 * near);
          for (let k = 0; k < perRow; k++) {
            blades.push({
              x: rng() * cols, y, h: 1 + near * rng.range(2, rows * 0.16), lean: rng.range(-0.4, 0.4),
              phase: rng() * 6, flower: rng() < 0.03 ? rng.range(0.5, 1) : 0,
            });
          }
        }
        for (let k = 0; k < MAX_FLIES; k++) {
          fx[k] = rng() * cols;
          fy[k] = horizon - rows * 0.08 + rng() * (rows - horizon) * 0.95;
          fvx[k] = 0; fvy[k] = 0;
          theta[k] = rng();
          period[k] = rng.range(3, 7);
          since[k] = 99;
          doubles[k] = rng() < 0.3 ? 1 : 0;
          seed[k] = rng() * 100;
        }
        lw = Math.ceil(cols / 2); lh = Math.ceil(rows / 2);
        light = new Float32Array(lw * lh);
        t = rng() * 100;
        syncEvent = -1;
      },
      update(dt, audio, ctx) {
        t += dt;
        active = Math.round(MAX_FLIES * ctx.params.count * clamp((cols * rows) / 15000, 0.25, 1));
        // coupling: a little always; during a sync event it ramps up and the rhythms converge
        let K = ctx.params.sync * 0.04;
        if (syncEvent >= 0) {
          syncEvent += dt;
          K = Math.max(K, 0.14 * smoothstep(0, 30, syncEvent) * smoothstep(200, 160, syncEvent));
          if (syncEvent > 200) syncEvent = -1;
        }
        const target = 4.5;
        for (let k = 0; k < active; k++) {
          // slow, wandering flight, mostly over the grass
          const ax = ctx.noise.n3(fx[k] * 0.05, fy[k] * 0.08, t * 0.1 + seed[k]) * 1.6;
          const ay = ctx.noise.n3(fx[k] * 0.05 + 50, fy[k] * 0.08, t * 0.1 + seed[k]) * 1.2;
          fvx[k] += (ax - fvx[k]) * Math.min(1, dt * 0.8);
          fvy[k] += (ay - fvy[k]) * Math.min(1, dt * 0.8);
          fx[k] += fvx[k] * dt;
          fy[k] += fvy[k] * dt * 0.6;
          const top = horizon - rows * 0.1;
          if (fy[k] < top) fvy[k] += dt * 2;
          if (fy[k] > rows - 1) fvy[k] -= dt * 2;
          if (fx[k] < -2) fx[k] += cols + 4;
          if (fx[k] > cols + 2) fx[k] -= cols + 4;
          if (syncEvent >= 0) period[k] += (target - period[k]) * Math.min(1, dt * 0.06);
          since[k] += dt;
          theta[k] += dt / period[k];
        }
        // fire, and nudge the neighbours (pulse-coupled oscillators)
        for (let k = 0; k < active; k++) {
          if (theta[k] < 1) continue;
          theta[k] -= 1;
          since[k] = 0;
          if (K <= 0) continue;
          for (let j = 0; j < active; j++) {
            // refractory: a firefly that flashed recently ignores its neighbours, which also
            // guarantees no one can re-flash faster than its own rhythm allows
            if (j === k || theta[j] >= 1 || theta[j] < 0.35) continue;
            const dx = (fx[j] - fx[k]) * aspect, dy = fy[j] - fy[k];
            const d2 = dx * dx + dy * dy;
            const R = rows * (syncEvent >= 0 ? 0.35 : 0.15);
            if (d2 < R * R) theta[j] = Math.min(0.999, theta[j] + K * (0.3 + theta[j]));
          }
        }
        sinceBeat += dt;
        if (audio.beat > 0.8 && sinceBeat > 1.5) {
          // the music sets off a little cluster of flashes
          sinceBeat = 0;
          const cx = rng() * cols, cy = horizon + rng() * (rows - horizon);
          for (let k = 0; k < active; k++) {
            if (Math.hypot((fx[k] - cx) * aspect, fy[k] - cy) < rows * 0.15 && since[k] > FLASH * 1.5) { since[k] = rng() * 0.2; theta[k] = 0; }
          }
        }
        // the light they cast on the grass
        light.fill(0);
        for (let k = 0; k < active; k++) {
          const b = brightness(k);
          if (b < 0.05) continue;
          const lx = fx[k] / 2, ly = fy[k] / 2;
          const r = 3;
          for (let y = Math.max(0, Math.floor(ly - r)); y <= Math.min(lh - 1, ly + r); y++) {
            for (let x = Math.max(0, Math.floor(lx - r / aspect)); x <= Math.min(lw - 1, lx + r / aspect); x++) {
              const dx = (x - lx) * aspect, dy = y - ly;
              light[y * lw + x] += b * Math.exp(-(dx * dx + dy * dy) / 2.5);
            }
          }
        }
      },
      event() {
        syncEvent = 0;
      },
      render(grid, ctx) {
        const V = grid.v, C = grid.col, G = grid.glyph;
        const wind = ctx.params.wind;
        // dusk sky: deep blue overhead, a lingering teal glow at the horizon
        for (let y = 0; y < horizon; y++) {
          const low = y / horizon;
          for (let x = 0; x < cols; x++) {
            const i = y * cols + x;
            V[i] = 0.01 + 0.11 * low ** 4;
            C[i * 3] = 0.25 + 0.2 * low; C[i * 3 + 1] = 0.4 + 0.35 * low; C[i * 3 + 2] = 0.85 - 0.15 * low;
          }
        }
        stars.render(grid, t, aspect, 0, { horizon, occluded: (x, y) => y >= trees[x | 0] });
        // treeline and meadow ground in silhouette
        for (let x = 0; x < cols; x++) {
          for (let y = Math.max(0, Math.floor(trees[x])); y < rows; y++) {
            const i = y * cols + x;
            // the crest of the treeline gets a soft edge against the glowing sky
            const crest = y === Math.floor(trees[x]) && y < horizon;
            V[i] = crest ? 0.05 : y >= horizon ? 0.008 : 0;
            G[i] = crest ? cp(hash2(x, 0, 5) > 0.5 ? '^' : '*') : 0;
            C[i * 3] = 0.3; C[i * 3 + 1] = 0.5; C[i * 3 + 2] = 0.35;
          }
        }
        // low mist drifting over the meadow
        const mistAmt = ctx.params.mist;
        if (mistAmt > 0) {
          mist.update(cols, rows, (x, y) => {
            const band = Math.exp(-(((y - horizon - rows * 0.06) / (rows * 0.09)) ** 2));
            return band * smoothstep(-0.2, 0.6, ctx.noise.fbm2(x * aspect * 0.02 - t * 0.01, y * 0.06, 3));
          });
          for (let y = horizon + 1; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
              const m = mist.sample(x, y) * mistAmt * 0.06;
              if (m < 0.005) continue;
              const i = y * cols + x;
              V[i] += m;
              C[i * 3] = 0.55; C[i * 3 + 1] = 0.65; C[i * 3 + 2] = 0.75;
            }
          }
        }
        // grass, swaying in the breeze and lit by nearby fireflies
        for (const b of blades) {
          const near = (b.y - horizon) / (rows - horizon);
          const gust = Math.sin(t * 0.7 + b.x * 0.05) * 0.5 + 0.5;
          let x = b.x, y = b.y;
          for (let s = 1; s <= b.h; s++) {
            const f = s / b.h;
            const sway = (b.lean + Math.sin(t * 1.2 + b.phase + b.x * 0.08) * 0.35 * wind * (0.5 + gust)) * f * f * 1.6;
            const nx = b.x + sway / aspect * 0.5, ny = b.y - s * 0.9;
            const li = ((ny / 2) | 0) * lw + ((nx / 2) | 0);
            const lit = li >= 0 && li < light.length ? light[li] : 0;
            const v = clamp(0.02 + 0.03 * near + lit * 0.5);
            const w = clamp(lit * 1.5);
            grid.max(nx, ny, v, 0.3 + 0.55 * w, 0.55 + 0.4 * w, 0.3 + 0.1 * w, lineGlyph(nx - x, ny - y, aspect));
            x = nx; y = ny;
          }
          if (b.flower > 0) grid.max(x, y - 0.6, clamp(0.12 * b.flower + 0.4 * (light[((y / 2) | 0) * lw + ((x / 2) | 0)] ?? 0)), 0.9, 0.85, 1, cp(hash2(b.x | 0, b.y, 3) > 0.5 ? '*' : 'o'));
        }
        // fireflies: a warm yellow-green glow and a soft halo
        for (let k = 0; k < active; k++) {
          const b = brightness(k);
          const depth = clamp((fy[k] - horizon + rows * 0.1) / (rows - horizon));
          if (b < 0.03) {
            // between flashes they are just visible as faint dark specks near the viewer
            continue;
          }
          const v = clamp(b * (0.55 + 0.45 * depth));
          grid.max(fx[k], fy[k], v, 0.8, 1, 0.35, cp(v > 0.75 ? '*' : v > 0.4 ? '+' : '.'));
          const halo = v * 0.25;
          grid.max(fx[k] + 1, fy[k], halo, 0.75, 1, 0.35);
          grid.max(fx[k] - 1, fy[k], halo, 0.75, 1, 0.35);
          grid.max(fx[k], fy[k] - 1, halo * 0.7, 0.75, 1, 0.35);
          grid.max(fx[k], fy[k] + 1, halo * 0.7, 0.75, 1, 0.35);
        }
      },
    };
  },
};

export default fireflies;
