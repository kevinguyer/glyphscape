import { clamp, fexp, smoothstep } from '../engine/math';
import type { SceneDef } from '../engine/types';
import { Meteors } from './kit';

const cp = (c: string) => c.codePointAt(0)!;

/** Layered curtains of light rippling over a starfield and a dark mountain ridge. */
const aurora: SceneDef = {
  id: 'aurora',
  name: 'Aurora',
  family: 'procedural',
  blurb: 'Layered curtains of light over a starfield',
  recommended: { style: 'borealis' },
  defaultSeed: 8213,
  params: [
    { key: 'speed', label: 'Speed', min: 0.1, max: 3, default: 1 },
    { key: 'density', label: 'Density', min: 0, max: 1, default: 0.6 },
    { key: 'layers', label: 'Curtains', min: 1, max: 4, default: 3, step: 1 },
    { key: 'shimmer', label: 'Shimmer', min: 0, max: 1, default: 0.5 },
  ],
  create() {
    let t = 0;
    let cols = 0, rows = 0;
    let ridge = new Float32Array(0);
    let trees = new Float32Array(0);
    let starX = new Float32Array(0), starY = new Float32Array(0), starP = new Float32Array(0);
    const L = 4;
    let edge = new Float32Array(0), ray = new Float32Array(0), hgt = new Float32Array(0), fold = new Float32Array(0);
    let widen = 0, shimmer = 0;
    const meteors = new Meteors(4);
    const layerAmp = [1, 0.7, 0.5, 0.35];
    const layerOff = [0, -0.12, 0.08, -0.2];

    return {
      init(ctx) {
        cols = ctx.cols; rows = ctx.rows;
        const { noise, rng } = ctx;
        ridge = new Float32Array(cols);
        trees = new Float32Array(cols);
        for (let x = 0; x < cols; x++) {
          const u = x * ctx.aspect;
          ridge[x] = rows * (0.14 + 0.07 * noise.fbm2(u * 0.012, 3.3, 4) + 0.02 * noise.n2(u * 0.05, 9));
          // a darker foreground treeline
          const tn = noise.n2(u * 0.09, 17);
          trees[x] = rows * 0.05 + (tn > 0.1 ? (tn - 0.1) * rows * 0.06 : 0) + (rng() < 0.25 ? rows * 0.01 * rng() : 0);
        }
        const ns = Math.floor((cols * rows) / 70);
        starX = new Float32Array(ns); starY = new Float32Array(ns); starP = new Float32Array(ns);
        for (let i = 0; i < ns; i++) {
          starX[i] = rng() * cols; starY[i] = rng() * rows * 0.85; starP[i] = rng() * 6.28;
        }
        edge = new Float32Array(cols * L); ray = new Float32Array(cols * L); hgt = new Float32Array(cols * L); fold = new Float32Array(cols * L);
        t = rng() * 1000;
      },
      update(dt, audio, ctx) {
        t += dt * ctx.params.speed;
        widen += (audio.bands[0] - widen) * Math.min(1, dt * 2);
        shimmer += (audio.bands[3] - shimmer) * Math.min(1, dt * 4);
        const { noise, aspect } = ctx;
        const nl = Math.round(ctx.params.layers);
        for (let l = 0; l < nl; l++) {
          const base = rows * (0.46 + layerOff[l]);
          const sh = ctx.params.shimmer + shimmer;
          for (let x = 0; x < cols; x++) {
            const u = x * aspect;
            // the lower edge folds and ripples slowly
            const e = base
              + noise.fbm2(u * 0.007 + t * 0.01 * (1 + l * 0.3), l * 7.7 + t * 0.005, 3) * rows * 0.32
              + Math.sin(u * 0.05 + t * 0.08 + l) * rows * 0.02;
            const k = l * cols + x;
            edge[k] = e;
            // vertical rays: fine stripes that slide along the curtain, plus broad bright patches
            const r = 0.5 + 0.5 * noise.n2(u * 0.3 + t * 0.06 + l * 50, t * (0.04 + sh * 0.12));
            const r2 = 0.5 + 0.5 * noise.n2(u * 0.08 - t * 0.02, l * 13 + t * 0.01);
            const patch = 0.3 + 0.7 * smoothstep(-0.5, 0.3, noise.n2(u * 0.011 + t * 0.006, l * 3 + 100));
            ray[k] = clamp(Math.pow(r, 2.4) * 1.4 + r2 * r2 * 0.35) * patch;
            hgt[k] = rows * (0.22 + 0.2 * (0.5 + 0.5 * noise.n2(u * 0.012, l * 5 + t * 0.008))) * (1 + widen * 0.6);
          }
          for (let x = 0; x < cols; x++) {
            const k = l * cols + x;
            const a = edge[k - (x > 0 ? 1 : 0)], b = edge[k + (x < cols - 1 ? 1 : 0)];
            fold[k] = 1 + Math.min(0.8, Math.abs(b - a) * aspect * 0.6);
          }
        }
        meteors.update(dt);
      },
      event(ctx) {
        meteors.spawn({
          x: ctx.rng.range(0.2, 0.8) * cols, y: ctx.rng.range(0.05, 0.3) * rows,
          vx: (ctx.rng() < 0.5 ? -1 : 1) * cols * 0.35, vy: rows * 0.12, life: 1.6, tail: 0.2,
        });
      },
      render(grid, ctx) {
        const V = grid.v, C = grid.col, G = grid.glyph;
        const nl = Math.round(ctx.params.layers);
        const dens = ctx.params.density;
        // Sky and curtains
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const gy = rows - ridge[x];
            if (y >= gy) continue;
            let sum = 0, r = 0, g = 0, b = 0;
            for (let l = 0; l < nl; l++) {
              const k = l * cols + x;
              const e = edge[k];
              const d = e - y; // >0 above the lower edge
              let p: number;
              if (d < 0) p = fexp(d / (rows * 0.008));
              else p = fexp(-d / hgt[k]) * (1 - 0.7 * fexp(-d / (rows * 0.01)));
              const I = p * ray[k] * fold[k] * layerAmp[l] * (0.35 + dens * 0.9);
              if (I < 0.003) continue;
              // green at the lower edge, violet and rose higher up
              const h = smoothstep(0.05, 1, d / (hgt[k] * 1.6));
              const lr = 0.25 + 0.55 * h, lg = 1 - 0.75 * h, lb = 0.55 + 0.4 * h;
              sum += I; r += lr * I; g += lg * I; b += lb * I;
            }
            const i = y * cols + x;
            const sky = 0.025 * (y / gy);
            const v = clamp((1 - fexp(-sum * 1.5) - 0.05) * 1.1 + sky);
            V[i] = v;
            const c = i * 3;
            if (sum > 0) {
              C[c] = r / sum; C[c + 1] = g / sum; C[c + 2] = b / sum;
            } else {
              C[c] = 0.3; C[c + 1] = 0.4; C[c + 2] = 0.8;
            }
          }
        }
        // Stars, dimmed behind bright curtains
        for (let i = 0; i < starX.length; i++) {
          const x = starX[i] | 0, y = starY[i] | 0;
          if (y >= rows - ridge[x]) continue;
          const k = y * cols + x;
          const tw = 0.5 + 0.5 * Math.sin(t * 0.7 + starP[i]);
          const b = (0.18 + 0.32 * tw) * (1 - clamp(V[k] * 2));
          if (b > V[k]) {
            V[k] = b;
            G[k] = tw > 0.85 ? cp('+') : cp('.');
            C[k * 3] = 0.9; C[k * 3 + 1] = 0.92; C[k * 3 + 2] = 1;
          }
        }
        // Ridge with a faint rim of reflected aurora, and the foreground treeline
        for (let x = 0; x < cols; x++) {
          const gy = Math.floor(rows - ridge[x]);
          let glowAbove = 0;
          for (let l = 0; l < nl; l++) glowAbove += ray[l * cols + x] * layerAmp[l];
          if (gy >= 0 && gy < rows) {
            const i = gy * cols + x;
            V[i] = 0.06 + glowAbove * 0.06;
            G[i] = cp('_');
            C[i * 3] = 0.6; C[i * 3 + 1] = 0.9; C[i * 3 + 2] = 0.8;
          }
          const ty = Math.floor(rows - trees[x]);
          for (let y = ty; y < rows; y++) {
            const i = y * cols + x;
            V[i] = 0;
            G[i] = 0;
          }
          if (ty > 0 && trees[x] > rows * 0.055) {
            const i = (ty - 1) * cols + x;
            V[i] = 0.07;
            G[i] = cp('^');
            C[i * 3] = 0.5; C[i * 3 + 1] = 0.75; C[i * 3 + 2] = 0.6;
          }
        }
        meteors.render(grid, ctx.aspect);
      },
    };
  },
};

export default aurora;
