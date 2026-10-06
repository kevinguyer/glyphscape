import { clamp, hsv, smoothstep, type RGB } from '../engine/math';
import { LowResField } from '../engine/field';
import type { SceneDef } from '../engine/types';
import { Meteors } from './kit';

const STAR_GLYPHS = ['.', '·', '+', '*', '✦'].map((c) => c.codePointAt(0)!);

/** Slow parallax flight through stars, with the occasional nebula and a rare shooting star. */
const starfield: SceneDef = {
  id: 'starfield',
  name: 'Starfield Drift',
  family: 'particle',
  blurb: 'Slow parallax flight through stars and nebulae',
  recommended: { style: 'clean-mono', colorMode: 'native' },
  defaultSeed: 1969,
  params: [
    { key: 'speed', label: 'Speed', min: 0.05, max: 3, default: 0.5 },
    { key: 'density', label: 'Density', min: 0.1, max: 1, default: 0.55 },
    { key: 'nebula', label: 'Nebula', min: 0, max: 1, default: 0.6 },
  ],
  create() {
    const MAX = 2400;
    const sx = new Float32Array(MAX), sy = new Float32Array(MAX), sz = new Float32Array(MAX);
    const temp = new Float32Array(MAX), tw = new Float32Array(MAX);
    let count = 0;
    let t = 0;
    let vel = 0;
    let yaw = 0;
    // Shooting star
    const meteors = new Meteors(4);
    const rgb: RGB = [0, 0, 0];
    const dens = new LowResField(2, 6);
    const hue = new LowResField(6, 12);

    const respawn = (i: number, rng: () => number, far: boolean) => {
      sx[i] = (rng() - 0.5) * 2;
      sy[i] = (rng() - 0.5) * 2;
      sz[i] = far ? 0.9 + rng() * 0.1 : 0.05 + rng() * 0.95;
      temp[i] = rng();
      tw[i] = rng() * 6.28;
    };

    return {
      init(ctx) {
        count = 0;
        for (let i = 0; i < MAX; i++) respawn(i, ctx.rng, false);
        t = ctx.rng() * 100;
      },
      update(dt, audio, ctx) {
        t += dt;
        count = Math.floor(MAX * ctx.params.density * clamp((ctx.cols * ctx.rows) / 20000, 0.25, 1));
        const target = ctx.params.speed * (1 + audio.bands[0] * 1.5);
        vel += (target - vel) * Math.min(1, dt * 0.8);
        yaw = Math.sin(t * 0.013) * 0.15;
        const dz = vel * dt * 0.06;
        for (let i = 0; i < count; i++) {
          sz[i] -= dz;
          if (sz[i] <= 0.03) respawn(i, ctx.rng, true);
        }
        meteors.update(dt);
      },
      event(ctx) {
        const sp = ctx.cols * 0.32;
        meteors.spawn({
          x: ctx.rng.range(0.1, 0.6) * ctx.cols, y: ctx.rng.range(0.05, 0.35) * ctx.rows,
          vx: sp * ctx.rng.range(0.7, 1), vy: sp * ctx.rng.range(0.15, 0.35) * ctx.aspect,
          life: 2, tail: 0.25, train: 0.4,
        });
      },
      render(grid, ctx) {
        const { cols, rows, aspect, noise } = ctx;
        const nebAmt = ctx.params.nebula;
        // Nebula: slow, faint clouds whose presence itself waxes and wanes.
        if (nebAmt > 0) {
          const presence = clamp(0.65 + 0.45 * noise.n2(t * 0.004, 7.3)) * nebAmt;
          if (presence > 0.02) {
            const drift = t * 0.01 * (0.4 + vel);
            dens.update(cols, rows, (x, y) => {
              // broad clouds shaped by fine filaments, with soft edges
              const a = noise.fbm3(x * aspect * 0.022 + drift, y * 0.022, t * 0.003, 4);
              const b = noise.fbm3(x * aspect * 0.075 + drift * 1.5 + 20, y * 0.075, t * 0.005, 3);
              const base = smoothstep(-0.2, 0.55, a);
              return base * base * (0.3 + 0.7 * smoothstep(-0.35, 0.55, b));
            });
            hue.update(cols, rows, (x, y) => 0.62 + noise.n2(x * aspect * 0.014 + drift * 0.4, y * 0.014 + 50) * 0.22);
            for (let y = 0; y < rows; y += 1) {
              for (let x = 0; x < cols; x += 1) {
                const n = dens.sample(x, y) * presence * 0.6;
                if (n < 0.01) continue;
                hsv(hue.sample(x, y), 0.65, 1, rgb);
                const i = y * cols + x;
                grid.v[i] = n;
                const c = i * 3;
                grid.col[c] = rgb[0]; grid.col[c + 1] = rgb[1]; grid.col[c + 2] = rgb[2];
              }
            }
          }
        }
        const cx = cols / 2, cy = rows / 2;
        const scale = Math.min(cols * aspect, rows) * 0.5;
        const cy0 = Math.cos(yaw), sy0 = Math.sin(yaw);
        for (let i = 0; i < count; i++) {
          const z = sz[i];
          const x3 = sx[i] * cy0 - z * sy0 * 0.3;
          const px = cx + (x3 / z) * scale / aspect;
          const py = cy + (sy[i] / z) * scale;
          if (px < 0 || py < 0 || px >= cols || py >= rows) continue;
          const near = 1 - z;
          let b = clamp(near * near * 1.25 + 0.08);
          b *= 0.82 + 0.18 * Math.sin(t * 1.3 + tw[i]); // gentle twinkle
          const tt = temp[i];
          const r = tt < 0.3 ? 0.75 : 1, g = tt < 0.3 ? 0.85 : tt > 0.85 ? 0.85 : 0.95, bl = tt > 0.85 ? 0.7 : tt < 0.3 ? 1 : 0.9;
          const gl = STAR_GLYPHS[Math.min(4, Math.floor(b * 4.6))];
          grid.max(px, py, b, r, g, bl, gl);
          if (b > 0.75) {
            // Bright, near stars get a soft cross of light.
            const h = (b - 0.75) * 1.4;
            grid.max(px + 1, py, h, r, g, bl);
            grid.max(px - 1, py, h, r, g, bl);
            grid.max(px, py + 1, h * 0.6, r, g, bl);
            grid.max(px, py - 1, h * 0.6, r, g, bl);
          }
        }
        meteors.render(grid, aspect);
      },
    };
  },
};

export default starfield;
