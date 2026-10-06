import { LowResFieldN } from '../engine/field';
import { clamp, fexp, fsin } from '../engine/math';
import type { SceneDef } from '../engine/types';

const cp = (c: string) => c.codePointAt(0)!;

/**
 * Rain on a window at night: blurred streetlights behind the glass, rain falling beyond it,
 * and droplets on the pane that grow, merge, and run, leaving wet trails.
 */
const rain: SceneDef = {
  id: 'rain',
  name: 'Rain on Glass',
  family: 'particle',
  blurb: 'Droplets merge and run past blurred streetlights',
  recommended: { style: 'braille-fine', colorMode: 'native' },
  defaultSeed: 2024,
  params: [
    { key: 'intensity', label: 'Rain', min: 0.05, max: 1, default: 0.5 },
    { key: 'wind', label: 'Wind', min: 0, max: 1, default: 0.25 },
    { key: 'speed', label: 'Speed', min: 0.2, max: 2, default: 1 },
  ],
  create() {
    // Falling streaks beyond the glass.
    const SMAX = 900;
    const fx = new Float32Array(SMAX), fy = new Float32Array(SMAX), fv = new Float32Array(SMAX), flen = new Float32Array(SMAX);
    // Droplets on the glass.
    const DMAX = 700;
    const dx = new Float32Array(DMAX), dy = new Float32Array(DMAX), dr = new Float32Array(DMAX);
    const dvy = new Float32Array(DMAX), drun = new Uint8Array(DMAX), dalive = new Uint8Array(DMAX);
    const dwob = new Float32Array(DMAX);
    let trail = new Float32Array(0);
    // Streetlights (bokeh)
    const LMAX = 7;
    const lx = new Float32Array(LMAX), ly = new Float32Array(LMAX), lr = new Float32Array(LMAX);
    const lc = new Float32Array(LMAX * 3), lp = new Float32Array(LMAX);
    let lights = 0;
    const glow = new LowResFieldN(4, 2, 3);
    const gs = new Float32Array(4);
    let t = 0, wind = 0, windTarget = 0, gust = 0, flash = -1;
    let cols = 0, rows = 0;
    let R: () => number = Math.random;

    const spawnDrop = (x: number, y: number, r: number) => {
      for (let i = 0; i < DMAX; i++) {
        if (!dalive[i]) {
          dalive[i] = 1; dx[i] = x; dy[i] = y; dr[i] = r; dvy[i] = 0; drun[i] = 0; dwob[i] = R() * 6.28;
          return i;
        }
      }
      return -1;
    };

    return {
      init(ctx) {
        cols = ctx.cols; rows = ctx.rows;
        R = ctx.rng;
        const rng = ctx.rng;
        for (let i = 0; i < SMAX; i++) {
          fx[i] = rng() * cols; fy[i] = rng() * rows; fv[i] = rng.range(18, 34); flen[i] = rng.range(1, 3.5);
        }
        dalive.fill(0);
        trail = new Float32Array(cols * rows);
        lights = rng.int(4, LMAX + 1);
        const palette = [[1, 0.68, 0.32], [1, 0.78, 0.45], [0.95, 0.55, 0.3], [0.45, 0.85, 0.9], [1, 0.35, 0.3], [0.8, 0.85, 1]];
        for (let i = 0; i < lights; i++) {
          lx[i] = rng.range(0.05, 0.95) * cols;
          ly[i] = rng.range(0.25, 0.85) * rows;
          lr[i] = rng.range(0.08, 0.2) * rows;
          const c = i < 3 ? palette[i] : rng.pick(palette);
          lc[i * 3] = c[0]; lc[i * 3 + 1] = c[1]; lc[i * 3 + 2] = c[2];
          lp[i] = rng() * 6.28;
        }
        // Seed some droplets already on the glass.
        for (let i = 0; i < 160 * (cols * rows) / 20000; i++) spawnDrop(rng() * cols, rng() * rows, rng.range(0.25, 0.9));
        t = 0;
      },
      update(dt0, audio, ctx) {
        const dt = dt0 * ctx.params.speed;
        t += dt;
        const rng = ctx.rng;
        const inten = ctx.params.intensity;
        if (audio.beat > 0.7 && gust < 0.2) gust = 1;
        gust = Math.max(0, gust - dt * 0.35);
        if (rng() < dt * 0.05) windTarget = (rng() - 0.3) * ctx.params.wind;
        wind += (windTarget * (1 + gust * 1.5) - wind) * Math.min(1, dt * 0.4);
        // Falling rain
        const active = Math.floor(SMAX * inten * clamp((cols * rows) / 18000, 0.3, 1));
        for (let i = 0; i < active; i++) {
          fy[i] += fv[i] * dt;
          fx[i] += fv[i] * wind * 0.6 * dt;
          if (fy[i] > rows + 3) { fy[i] = -rng() * 6; fx[i] = rng() * cols; }
          if (fx[i] < -2) fx[i] += cols + 4;
          if (fx[i] > cols + 2) fx[i] -= cols + 4;
        }
        // New droplets hitting the glass
        const hits = (inten * 30 * (1 + gust * 2) * (cols * rows)) / 20000 * dt;
        let n = Math.floor(hits) + (rng() < hits % 1 ? 1 : 0);
        while (n-- > 0) {
          const x = rng() * cols, y = rng() * rows, r = rng.range(0.18, 0.55);
          // Merge with any drop it lands on.
          let merged = false;
          for (let j = 0; j < DMAX; j++) {
            if (!dalive[j]) continue;
            const ddx = (dx[j] - x) * ctx.aspect, ddy = dy[j] - y;
            if (ddx * ddx + ddy * ddy < (dr[j] + r) * (dr[j] + r) * 0.8) {
              dr[j] = Math.sqrt(dr[j] * dr[j] + r * r);
              merged = true;
              break;
            }
          }
          if (!merged) spawnDrop(x, y, r);
        }
        // Drops: heavy ones run, absorbing what they touch
        for (let i = 0; i < DMAX; i++) {
          if (!dalive[i]) continue;
          if (!drun[i]) {
            dr[i] *= 1 - dt * 0.004; // slow evaporation
            if (dr[i] > 1.05 || (dr[i] > 0.8 && rng() < dt * 0.02)) drun[i] = 1;
            if (dr[i] < 0.12) dalive[i] = 0;
            continue;
          }
          dvy[i] = Math.min(6 + dr[i] * 5, dvy[i] + dt * 7);
          // Runners stutter: they slow and surge as they meet dry glass.
          const stick = 0.55 + 0.45 * Math.sin(t * 2.3 + dwob[i] * 3);
          dy[i] += dvy[i] * dt * stick;
          dx[i] += (Math.sin(t * 1.7 + dwob[i]) * 0.6 + wind * 2) * dt;
          dr[i] -= dt * 0.03;
          const tx = dx[i] | 0, ty = dy[i] | 0;
          if (tx >= 0 && ty >= 0 && tx < cols && ty < rows) trail[ty * cols + tx] = Math.min(1, trail[ty * cols + tx] + 0.6);
          if (rng() < dt * 1.8) spawnDrop(dx[i] + (rng() - 0.5) * 0.6, dy[i] - 1, dr[i] * 0.35);
          for (let j = 0; j < DMAX; j++) {
            if (j === i || !dalive[j] || drun[j]) continue;
            const ddx = (dx[j] - dx[i]) * ctx.aspect, ddy = dy[j] - dy[i];
            const rr = dr[j] + dr[i];
            if (ddx * ddx + ddy * ddy < rr * rr) {
              dr[i] = Math.min(1.6, Math.sqrt(dr[i] * dr[i] + dr[j] * dr[j] * 0.6));
              dalive[j] = 0;
            }
          }
          if (dy[i] > rows + 2 || dr[i] < 0.3) dalive[i] = 0;
        }
        const decay = Math.exp(-dt * 0.12);
        for (let i = 0; i < trail.length; i++) trail[i] *= decay;
        if (flash >= 0) {
          flash += dt;
          if (flash > 4) flash = -1;
        }
      },
      event(ctx) {
        flash = 0;
        if (ctx.reducedMotion) flash = 1.2; // skip the bright rise
      },
      render(grid, ctx) {
        const { aspect } = ctx;
        // Lightning is one slow, soft swell. Never a strobe.
        let fl = 0;
        if (flash >= 0) fl = flash < 0.6 ? flash / 0.6 : Math.exp(-(flash - 0.6) * 1.3);
        if (ctx.reducedMotion) fl *= 0.35;
        // Blurred streetlights behind the glass
        // One pass computes the glow and its weighted color (r, g, b) at low resolution.
        glow.update(cols, rows, (x, y, out, o) => {
          let sum = 0, w = 0, r = 0, g = 0, b = 0;
          for (let i = 0; i < lights; i++) {
            const ddx = (x - lx[i]) * aspect, ddy = y - ly[i];
            const d2 = (ddx * ddx + ddy * ddy) / (lr[i] * lr[i]);
            const pulse = 0.85 + 0.15 * fsin(t * 0.2 + lp[i]);
            sum += fexp(-d2) * pulse;
            const e = fexp(-d2 * 0.5);
            r += e * lc[i * 3]; g += e * lc[i * 3 + 1]; b += e * lc[i * 3 + 2];
            w += e;
          }
          out[o] = sum;
          if (w > 1e-4) { out[o + 1] = r / w; out[o + 2] = g / w; out[o + 3] = b / w; }
          else { out[o + 1] = 0.7; out[o + 2] = 0.7; out[o + 3] = 0.7; }
        });
        const V = grid.v, C = grid.col;
        for (let y = 0; y < rows; y++) {
          const sky = 0.04 + 0.05 * (y / rows);
          for (let x = 0; x < cols; x++) {
            const i = y * cols + x;
            glow.sample(x, y, gs);
            V[i] = clamp(sky + gs[0] * 0.42 + fl * 0.35);
            const c = i * 3;
            C[c] = gs[1] * (1 - fl) + fl * 0.8;
            C[c + 1] = gs[2] * (1 - fl) + fl * 0.85;
            C[c + 2] = gs[3] * (1 - fl) + fl;
            const w = trail[i];
            if (w > 0.03) V[i] = clamp(V[i] * (1 - w * 0.5) + w * 0.12); // wet trails clear the fog a little
          }
        }
        // Falling rain beyond the glass
        const active = Math.floor(SMAX * ctx.params.intensity * clamp((cols * rows) / 18000, 0.3, 1));
        const slant = wind * 0.6;
        const gch = slant > 0.25 ? cp('/') : slant < -0.25 ? cp('\\') : cp('|');
        for (let i = 0; i < active; i++) {
          const len = flen[i] | 0;
          for (let k = 0; k <= len; k++) {
            const y = fy[i] - k;
            const x = fx[i] - k * slant;
            const b = 0.22 * (1 - k / (len + 1)) + 0.1 * glow.sample(x, y, gs)[0];
            grid.max(x, y, b, 0.65, 0.75, 0.9, gch);
          }
        }
        // Droplets on the glass, catching the light
        for (let i = 0; i < DMAX; i++) {
          if (!dalive[i]) continue;
          const r = dr[i];
          const x = dx[i], y = dy[i];
          glow.sample(x, y, gs);
          const lit = gs[0];
          const cr = 0.75 + 0.25 * gs[1], cg = 0.78 + 0.22 * gs[2], cb = 0.85 + 0.15 * gs[3];
          const base = 0.4 + lit * 0.5;
          if (r < 0.5) {
            grid.max(x, y, base * 0.8, cr, cg, cb, r < 0.3 ? cp('.') : cp('o'));
          } else {
            const rx = Math.ceil(r / aspect), ry = Math.ceil(r);
            for (let yy = -ry; yy <= ry; yy++) {
              for (let xx = -rx; xx <= rx; xx++) {
                const ddx = xx * aspect, ddy = yy;
                const d = Math.sqrt(ddx * ddx + ddy * ddy) / r;
                if (d > 1.05) continue;
                // Bright rim on the lower side, like a lens catching the light
                const rim = d > 0.6 ? 0.3 * (yy >= 0 ? 1 : 0.4) : 0;
                const glyph = d > 0.7 ? (yy < 0 ? (xx < 0 ? cp('(') : xx > 0 ? cp(')') : cp('-')) : xx < 0 ? cp('(') : xx > 0 ? cp(')') : cp('_')) : (r > 0.95 ? cp('O') : cp('o'));
                grid.max(x + xx, y + yy, clamp(base + rim), cr, cg, cb, glyph);
              }
            }
          }
          if (drun[i]) {
            // short glistening tail behind runners
            for (let k = 1; k < 4; k++) grid.max(x, y - k, (0.45 - k * 0.1) * (0.6 + lit), cr, cg, cb, cp(k === 1 ? '|' : ':'));
          }
        }
      },
    };
  },
};

export default rain;
