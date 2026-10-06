import { LowResField } from '../engine/field';
import { clamp, type RGB } from '../engine/math';
import type { SceneDef } from '../engine/types';
import { cp, fireColor } from './kit';


/** Rising sparks above a banked fire. */
const embers: SceneDef = {
  id: 'embers',
  name: 'Embers',
  family: 'particle',
  blurb: 'Rising sparks above a banked fire',
  recommended: { style: 'firelight' },
  defaultSeed: 777,
  params: [
    { key: 'rate', label: 'Ember rate', min: 0, max: 1, default: 0.5 },
    { key: 'rise', label: 'Rise speed', min: 0.2, max: 2, default: 1 },
    { key: 'turbulence', label: 'Turbulence', min: 0, max: 1, default: 0.5 },
    { key: 'flame', label: 'Flame height', min: 0, max: 1, default: 0.45 },
  ],
  create() {
    const MAX = 900;
    const px = new Float32Array(MAX), py = new Float32Array(MAX), vx = new Float32Array(MAX), vy = new Float32Array(MAX);
    const heat = new Float32Array(MAX), life = new Float32Array(MAX), seedv = new Float32Array(MAX);
    const alive = new Uint8Array(MAX);
    let t = 0, flare = 0, spawnAcc = 0;
    const rgb: RGB = [0, 0, 0];
    const flameN = new LowResField(2, 1), smokeN = new LowResField(3, 3);
    let coalCol = new Float32Array(0), tongueCol = new Float32Array(0);

    const spawn = (ctx: { cols: number; rows: number; rng: () => number }, burst = 1) => {
      for (let i = 0; i < MAX; i++) {
        if (alive[i]) continue;
        const r = ctx.rng;
        alive[i] = 1;
        px[i] = ctx.cols * (0.15 + 0.7 * r());
        py[i] = ctx.rows * (0.9 - 0.06 * r());
        vx[i] = (r() - 0.5) * 3 * burst;
        vy[i] = -(4 + r() * 6) * burst;
        heat[i] = 0.75 + r() * 0.25;
        life[i] = 0;
        seedv[i] = r() * 100;
        return;
      }
    };

    return {
      init(ctx) {
        alive.fill(0);
        t = ctx.rng() * 50;
        flare = 0;
      },
      update(dt, audio, ctx) {
        t += dt;
        const { noise, params } = ctx;
        const rate = (params.rate * 14 + audio.level * 22) * clamp(ctx.cols / 200, 0.3, 1.5);
        spawnAcc += rate * dt;
        if (audio.beat > 0.8) spawnAcc += 3;
        while (spawnAcc >= 1) {
          spawn(ctx);
          spawnAcc -= 1;
        }
        flare = Math.max(0, flare - dt * 0.3);
        const turb = params.turbulence * 9;
        const rise = params.rise;
        for (let i = 0; i < MAX; i++) {
          if (!alive[i]) continue;
          life[i] += dt;
          const n = noise.n3(px[i] * 0.06, py[i] * 0.06, t * 0.25 + seedv[i] * 0.01);
          vx[i] += n * turb * dt;
          vx[i] *= 1 - dt * 0.6;
          vy[i] += (-2.2 * heat[i] * rise - vy[i] * 0.25) * dt; // buoyancy vs drag
          px[i] += vx[i] * dt;
          py[i] += vy[i] * dt * rise;
          heat[i] -= dt * (0.09 + 0.05 * Math.sin(seedv[i]));
          if (heat[i] <= 0.02 || py[i] < -2 || px[i] < -3 || px[i] > ctx.cols + 3) alive[i] = 0;
          // A few sparks flare as they meet fresh air.
          if (heat[i] > 0.3 && ctx.rng() < dt * 0.04) heat[i] = Math.min(1, heat[i] + 0.25);
        }
      },
      event(ctx) {
        flare = 1;
        for (let k = 0; k < 90; k++) spawn(ctx, 1.4);
      },
      render(grid, ctx) {
        const { cols, rows, aspect, noise, params } = ctx;
        const V = grid.v, C = grid.col;
        const coalBase = rows * 0.075;
        const flameH = rows * (0.05 + params.flame * 0.22) * (1 + flare * 0.5);
        const top = Math.max(0, Math.floor(rows - coalBase * 1.6 - flameH * 1.4));
        // Ambient warm glow on the room
        for (let y = Math.floor(rows * 0.4); y < top; y++) {
          const g = Math.pow((y - rows * 0.4) / (top - rows * 0.4 + 1), 2) * 0.06 * (1 + flare);
          for (let x = 0; x < cols; x++) {
            const i = y * cols + x;
            V[i] = g;
            const c = i * 3;
            C[c] = 1; C[c + 1] = 0.45; C[c + 2] = 0.15;
          }
        }
        if (coalCol.length !== cols) { coalCol = new Float32Array(cols); tongueCol = new Float32Array(cols); }
        for (let x = 0; x < cols; x++) {
          const edge = Math.min(x, cols - 1 - x) / (cols * 0.12);
          coalCol[x] = coalBase * (0.7 + 0.5 * noise.n2(x * 0.06, 3.1)) * clamp(edge, 0.2, 1);
          tongueCol[x] = 0.55 + 0.45 * noise.n2(x * aspect * 0.045 + t * 0.05, t * 0.1);
        }
        flameN.update(cols, rows, (x, y) => (y < top - 2 ? 0 : noise.fbm3(x * aspect * 0.11, (rows - 1 - y) * 0.09 - t * 1.1, t * 0.18, 2)));
        smokeN.update(cols, rows, (x, y) => (y < top - 3 ? 0 : noise.fbm3(x * aspect * 0.05, (rows - 1 - y) * 0.05 - t * 0.35, t * 0.05, 2)));
        for (let y = top; y < rows; y++) {
          const yb = rows - 1 - y;
          for (let x = 0; x < cols; x++) {
            const i = y * cols + x;
            const edge = Math.min(x, cols - 1 - x) / (cols * 0.12);
            const coalH = coalCol[x];
            let v: number, temp: number;
            let glyph = 0;
            if (yb < coalH) {
              // Coals: slow-breathing glow with dark cracks
              const n = noise.fbm3(x * aspect * 0.18, yb * 0.35, t * 0.12, 2);
              const crack = Math.abs(noise.n2(x * aspect * 0.3, yb * 0.6 + 40));
              temp = clamp(0.45 + n * 0.5 + flare * 0.25 - (crack < 0.08 ? 0.35 : 0));
              v = clamp(0.35 + temp * 0.6);
            } else {
              const h = yb - coalH;
              const f = flameN.sample(x, y);
              const tongue = tongueCol[x];
              temp = clamp(f * 0.9 + tongue * 0.75 - h / (flameH * tongue + 0.01) * 0.9) * clamp(edge, 0, 1);
              v = temp * 0.95;
              if (temp < 0.05) {
                // Faint smoke wisps
                const sm = smokeN.sample(x, y);
                v = clamp(sm - 0.1) * 0.1 * clamp(1 - h / (rows * 0.4));
                if (v > 0.005) {
                  V[i] = Math.max(V[i], v);
                  const c = i * 3;
                  C[c] = 0.5; C[c + 1] = 0.45; C[c + 2] = 0.42;
                }
                continue;
              }
              if (temp > 0.15) glyph = h < flameH * 0.4 ? 0 : temp > 0.5 ? cp('^') : cp('\'');
            }
            fireColor(temp, rgb);
            V[i] = v;
            grid.glyph[i] = glyph;
            const c = i * 3;
            C[c] = rgb[0]; C[c + 1] = rgb[1]; C[c + 2] = rgb[2];
          }
        }
        for (let i = 0; i < MAX; i++) {
          if (!alive[i]) continue;
          const h = heat[i];
          fireColor(0.3 + h * 0.75, rgb);
          const g = h > 0.75 ? cp('*') : h > 0.5 ? cp('+') : h > 0.25 ? cp('\'') : cp('.');
          grid.max(px[i], py[i], clamp(0.25 + h * 0.8), rgb[0], rgb[1], rgb[2], g);
          // faint trail
          grid.max(px[i] - vx[i] * 0.06, py[i] - vy[i] * 0.08, h * 0.3, rgb[0], rgb[1] * 0.7, rgb[2] * 0.5, cp('.'));
        }
      },
    };
  },
};

export default embers;
