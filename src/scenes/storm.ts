import { LowResField } from '../engine/field';
import type { Grid } from '../engine/grid';
import { clamp, smoothstep } from '../engine/math';
import { hash2, type Rng } from '../engine/rng';
import type { SceneDef } from '../engine/types';
import { cp, Lightning, RainStreaks } from './kit';

const GRASS = [',', '.', '\'', '"'].map(cp);
const WINDOW = cp('▪');

/**
 * A night storm over open country: roiling clouds, driving rain, and lightning that lights
 * the clouds from inside and briefly reveals the hills, a lone tree and a farmhouse.
 */
const storm: SceneDef = {
  id: 'storm',
  name: 'Storm',
  family: 'scenic',
  blurb: 'Roiling clouds, driving rain and distant lightning',
  recommended: { style: 'midnight' },
  defaultSeed: 1883,
  params: [
    { key: 'rain', label: 'Rain', min: 0, max: 1, default: 0.65 },
    { key: 'wind', label: 'Wind', min: 0, max: 1, default: 0.35 },
    { key: 'lightning', label: 'Lightning', min: 0, max: 1, default: 0.5 },
    { key: 'clouds', label: 'Cloud speed', min: 0.1, max: 3, default: 1 },
  ],
  create() {
    let cols = 0, rows = 0, t = 0, drift = 0;
    let rng!: Rng;
    let ground = new Float32Array(0);
    let treeX = 0, houseX = 0;
    let wind = 0, gust = 0, nextFlash = 8, sinceBeat = 10;
    const rain = new RainStreaks(1400);
    const bolt = new Lightning();
    const cloud = new LowResField(2, 2);

    const groundAt = (x: number) => ground[Math.max(0, Math.min(cols - 1, x | 0))];
    const cloudBase = (x: number, noise: { n2(a: number, b: number): number }, aspect: number) =>
      rows * (0.44 + 0.05 * noise.n2(x * aspect * 0.02 + drift * 0.3, t * 0.01));

    return {
      init(ctx) {
        cols = ctx.cols; rows = ctx.rows; rng = ctx.rng;
        ground = new Float32Array(cols);
        for (let x = 0; x < cols; x++) {
          const u = x * ctx.aspect;
          ground[x] = rows * (0.8 - 0.07 * ctx.noise.fbm2(u * 0.012, 4.2, 3) - 0.02 * ctx.noise.n2(u * 0.05, 1));
        }
        // The tree stands on a rise; the farmhouse sits on the opposite side.
        treeX = Math.floor(cols * rng.range(0.15, 0.35));
        houseX = Math.floor(cols * rng.range(0.62, 0.82));
        rain.init(rng, cols, rows);
        bolt.reduced = ctx.reducedMotion;
        t = rng() * 100;
        nextFlash = rng.range(4, 10);
      },
      update(dt, audio, ctx) {
        t += dt;
        drift += dt * ctx.params.clouds * 0.6;
        bolt.reduced = ctx.reducedMotion;
        // Gusts come and go; bass pushes them a little.
        const target = ctx.params.wind * (0.6 + 0.4 * ctx.noise.n2(t * 0.05, 3)) + gust * 0.5;
        wind += (target - wind) * Math.min(1, dt * 0.5);
        gust = Math.max(0, gust - dt * 0.3, audio.bands[0] * 0.6);
        rain.update(dt, rng, ctx.params.rain * (0.85 + 0.3 * gust), wind * 0.8);
        bolt.update(dt);

        // Flash scheduling: frequent soft in-cloud flashes, occasional ground strikes.
        const freq = ctx.params.lightning;
        sinceBeat += dt;
        if (freq > 0) {
          nextFlash -= dt;
          if (audio.beat > 0.8 && sinceBeat > 6 && !bolt.busy) {
            sinceBeat = 0;
            bolt.sheet(rng, rng() * cols, rows * rng.range(0.1, 0.35), rows * 0.4, 0.4);
          }
          if (nextFlash <= 0 && !bolt.busy) {
            const x = cols * rng.range(0.08, 0.92);
            if (rng() < 0.35) {
              bolt.strike(rng, ctx.aspect, x, cloudBase(x, ctx.noise, ctx.aspect) - 2, (xx) => groundAt(xx), { spread: rows * 0.5 });
            } else {
              bolt.sheet(rng, x, rows * rng.range(0.08, 0.38), rows * rng.range(0.25, 0.5), rng.range(0.35, 0.7));
            }
            nextFlash = (40 - 34 * freq) * rng.range(0.5, 1.5);
          }
        }
      },
      event(ctx) {
        // Rare: spider lightning crawls along the whole cloud base.
        const dir = rng() < 0.5 ? 1 : -1;
        const x0 = dir > 0 ? cols * 0.08 : cols * 0.92;
        bolt.crawl(rng, ctx.aspect, x0, cloudBase(x0, ctx.noise, ctx.aspect) - 1, Math.floor(cols * 0.75), dir);
      },
      render(grid, ctx) {
        const { aspect, noise } = ctx;
        const V = grid.v, C = grid.col, G = grid.glyph;
        const flash = bolt.level();
        cloud.update(cols, rows, (x, y) => noise.fbm3(x * aspect * 0.022 - drift, y * 0.05, t * 0.015, 4));

        for (let x = 0; x < cols; x++) {
          const base = cloudBase(x, noise, aspect);
          const gy = groundAt(x);
          for (let y = 0; y < rows; y++) {
            const i = y * cols + x;
            const c = i * 3;
            if (y >= gy) continue; // ground drawn below
            const lit = bolt.light(x, y, aspect);
            // Cloud deck: dense above the base, ragged underneath
            const d = cloud.sample(x, y);
            const lump = d * rows * 0.06;
            const cover = smoothstep(base + 3 + lump, base - 4 + lump, y);
            const dens = clamp(0.5 + d * 1.5) * cover;
            const under = smoothstep(base - 8, base, y); // darker undersides
            let v = 0.03 + dens * dens * (0.3 - 0.12 * under) + lit * (0.12 + dens * 0.6) + flash * 0.05;
            // Haze between the clouds and the hills
            if (cover < 0.5) v = Math.max(v, 0.025 + 0.02 * (y - base) / (gy - base + 1) + lit * 0.06 + flash * 0.025);
            V[i] = clamp(v);
            const l = clamp(lit * 2 + flash * 0.5);
            C[c] = 0.5 + 0.4 * l; C[c + 1] = 0.56 + 0.34 * l; C[c + 2] = 0.72 + 0.28 * l;
          }
        }

        rain.render(grid, aspect, wind * 0.8, 0.2, [0.62, 0.7, 0.85], (x, y) => bolt.light(x, y, aspect) + flash * 0.3);
        bolt.renderBolt(grid);

        // Ground: dark until lightning reveals grass, the tree, and the house.
        const sparkleT = Math.floor(t * 4);
        for (let x = 0; x < cols; x++) {
          const gy = Math.floor(groundAt(x));
          for (let y = Math.max(0, gy); y < rows; y++) {
            const i = y * cols + x;
            const h = hash2(x, y, 5);
            const near = (y - gy) / (rows - gy + 1);
            // grass tufts catch the flash mostly along the crest of the hills
            const tuft = h > 0.7 + near * 0.25;
            V[i] = 0.012 + flash * (tuft ? 0.3 : 0.05) * (1 - near * 0.6);
            G[i] = flash > 0.08 && tuft ? GRASS[(h * 40) & 3] : 0;
            const c = i * 3;
            C[c] = 0.45; C[c + 1] = 0.55; C[c + 2] = 0.5;
            // rain splashes along the ground
            if (y === gy && hash2(x, sparkleT, 9) < ctx.params.rain * 0.12) {
              V[i] = 0.3; G[i] = cp('.'); C[c] = 0.7; C[c + 1] = 0.78; C[c + 2] = 0.9;
            }
          }
        }
        drawTree(grid, treeX, Math.floor(groundAt(treeX)), rows, flash, wind);
        drawHouse(grid, houseX, Math.floor(groundAt(houseX)), flash, t);
      },
    };
  },
};

/** A lone tree: a black silhouette with a lumpy crown, edged with light only during a flash. */
function drawTree(grid: Grid, x0: number, gy: number, rows: number, flash: number, wind: number) {
  const h = Math.max(5, Math.round(rows * 0.16));
  const crownR = Math.max(2.5, h * 0.42);
  const sway = wind * 0.5;
  const rim = flash * 0.45;
  const trunkTop = gy - h + crownR;
  for (let y = gy - 1; y >= trunkTop; y--) grid.set(x0, y, rim * 0.5, 0.6, 0.6, 0.55, cp('|'));
  // two forked branches into the crown
  grid.set(x0 - 1, trunkTop, rim * 0.5, 0.6, 0.6, 0.55, cp('\\'));
  grid.set(x0 + 1, trunkTop, rim * 0.5, 0.6, 0.6, 0.55, cp('/'));
  const cy = trunkTop - crownR * 0.55;
  const span = Math.ceil(crownR * 2.6);
  for (let yy = -Math.ceil(crownR); yy <= Math.ceil(crownR * 0.6); yy++) {
    for (let xx = -span; xx <= span; xx++) {
      const sx = xx * 0.42 - sway * (crownR - yy) * 0.25; // a broad crown, skewed by the wind
      const th = Math.atan2(yy, sx);
      const rr = crownR * (1 + 0.22 * Math.sin(4 * th + 1) + 0.14 * Math.sin(9 * th + 2)) * (yy > 0 ? 0.7 : 1);
      const d = Math.sqrt(sx * sx + yy * yy) / rr;
      if (d > 1) continue;
      // gaps in the foliage let the sky show through near the edge
      if (d > 0.55 && Math.sin(xx * 1.7 + yy * 2.3) * Math.sin(xx * 0.9 - yy * 1.3) > 0.45) continue;
      const edge = d > 0.82 && hash2(xx, yy, 77) > 0.35;
      grid.set(x0 + xx, cy + yy, edge ? rim : 0, 0.5, 0.62, 0.5, edge && rim > 0.05 ? cp(hash2(xx, yy, 3) > 0.5 ? '%' : '&') : 32);
    }
  }
}

/** A farmhouse with one warm window: the only steady light in the storm. */
function drawHouse(grid: Grid, x0: number, gy: number, flash: number, t: number) {
  const rim = flash * 0.45;
  const art = ['   /\\    ', '  /  \\__ ', ' /____\\_\\', ' |    | |', ' |    | |'];
  art.forEach((line, k) => {
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === ' ' && !(k >= 3 && j > 1 && j < 8)) continue;
      grid.set(x0 + j - 4, gy - art.length + k, ch === ' ' ? 0 : rim, 0.7, 0.68, 0.6, ch === ' ' ? 32 : cp(ch));
    }
  });
  // the window glows warmly, with the slow wander of a lamp inside
  const wv = 0.55 + 0.08 * Math.sin(t * 0.7);
  grid.set(x0 - 1, gy - 2, wv, 1, 0.72, 0.38, WINDOW);
  grid.max(x0 - 2, gy - 2, 0.12, 1, 0.7, 0.35);
  grid.max(x0, gy - 2, 0.12, 1, 0.7, 0.35);
}

export default storm;
