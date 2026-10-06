import { LowResFieldN } from '../engine/field';
import { clamp, hsv, TAU, type RGB } from '../engine/math';
import type { SceneDef } from '../engine/types';

// Direction glyphs for angles, in 8 steps of 22.5 degrees (lines are symmetric, so mod 180).
const DIR = ['-', '\\', '\\', '|', '|', '/', '/', '-'].map((c) => c.codePointAt(0)!);

/**
 * Thousands of glyph particles tracing evolving noise currents. Each cell shows the direction
 * of the current through it. Rarely, a whale glides through the flow.
 */
const flowfield: SceneDef = {
  id: 'flowfield',
  name: 'Flow Field',
  family: 'procedural',
  blurb: 'Glyph particles tracing evolving noise currents',
  recommended: { style: 'green-phosphor' },
  defaultSeed: 1977,
  params: [
    { key: 'speed', label: 'Speed', min: 0.1, max: 3, default: 1 },
    { key: 'density', label: 'Density', min: 0.1, max: 1, default: 0.5 },
    { key: 'scale', label: 'Scale', min: 0.3, max: 3, default: 1 },
    { key: 'turbulence', label: 'Turbulence', min: 0, max: 1, default: 0.35 },
  ],
  create() {
    const MAX = 9000;
    const px = new Float32Array(MAX), py = new Float32Array(MAX), age = new Float32Array(MAX), maxAge = new Float32Array(MAX);
    let trail = new Float32Array(0);
    let angle = new Float32Array(0);
    let cols = 0, rows = 0;
    let t = 0;
    let whale = -1, wx = 0, wy = 0, wdir = 1, wsize = 1;
    const rgb: RGB = [0, 0, 0];
    // Flow direction as (cos, sin), cached at half resolution: angles themselves can't be interpolated.
    const flow = new LowResFieldN(2, 2, 2);
    const fs = new Float32Array(2);

    const flowAngle = (ctx: { noise: { n3(a: number, b: number, c: number): number }; aspect: number; params: Record<string, number> }, x: number, y: number, bend: number) => {
      const s = 0.018 / ctx.params.scale;
      const n = ctx.noise.n3(x * ctx.aspect * s, y * s, t * 0.04);
      const n2 = ctx.noise.n3(x * ctx.aspect * s * 3.1 + 40, y * s * 3.1, t * 0.09);
      return (n * 1.4 + n2 * ctx.params.turbulence * 0.7) * TAU + bend;
    };

    return {
      init(ctx) {
        cols = ctx.cols; rows = ctx.rows;
        trail = new Float32Array(cols * rows);
        angle = new Float32Array(cols * rows);
        for (let i = 0; i < MAX; i++) {
          px[i] = ctx.rng() * cols; py[i] = ctx.rng() * rows;
          maxAge[i] = ctx.rng.range(3, 12);
          age[i] = ctx.rng() * maxAge[i];
        }
        t = ctx.rng() * 500;
      },
      update(dt, audio, ctx) {
        t += dt * ctx.params.speed;
        const bend = (audio.level * 0.8 + audio.beat * 0.6) * Math.sin(t * 0.3);
        const count = Math.floor(MAX * ctx.params.density * clamp((cols * rows) / 25000, 0.15, 1));
        const sp = 7 * ctx.params.speed;
        flow.update(cols, rows, (x, y, out, o) => {
          const a = flowAngle(ctx, x, y, bend);
          out[o] = Math.cos(a);
          out[o + 1] = Math.sin(a);
        });
        const decay = Math.exp(-dt * 2.2);
        for (let i = 0; i < trail.length; i++) trail[i] *= decay;
        for (let i = 0; i < count; i++) {
          age[i] += dt;
          if (age[i] > maxAge[i] || px[i] < 0 || py[i] < 0 || px[i] >= cols || py[i] >= rows) {
            px[i] = ctx.rng() * cols; py[i] = ctx.rng() * rows; age[i] = 0;
            continue;
          }
          flow.sample(px[i], py[i], fs);
          const m = Math.hypot(fs[0], fs[1]) || 1;
          const cx = fs[0] / m, cy = fs[1] / m;
          px[i] += (cx * sp * dt) / ctx.aspect;
          py[i] += cy * sp * dt;
          const ci = (py[i] | 0) * cols + (px[i] | 0);
          if (ci >= 0 && ci < trail.length) {
            // fade in and out over the particle's life so births and deaths don't pop
            const life = age[i] / maxAge[i];
            const w = Math.min(1, life * 6, (1 - life) * 4);
            trail[ci] = Math.min(1, trail[ci] + 0.22 * w);
            angle[ci] = Math.atan2(cy, cx);
          }
        }
        if (whale >= 0) {
          whale += dt;
          wx += wdir * dt * cols * 0.018;
          wy += Math.sin(whale * 0.2) * dt * 0.4;
          if (whale > 90 || wx < -cols * 0.4 || wx > cols * 1.4) whale = -1;
        }
      },
      event(ctx) {
        whale = 0;
        wdir = ctx.rng() < 0.5 ? 1 : -1;
        wsize = Math.min(cols * ctx.aspect * 0.32, rows * 0.55);
        wx = wdir > 0 ? -wsize / ctx.aspect : cols + wsize / ctx.aspect;
        wy = rows * ctx.rng.range(0.35, 0.65);
      },
      render(grid, ctx) {
        const V = grid.v, C = grid.col, G = grid.glyph;
        const hueBase = 0.33 + Math.sin(t * 0.01) * 0.12;
        for (let i = 0; i < trail.length; i++) {
          const v = trail[i];
          if (v < 0.02) continue;
          V[i] = clamp(v * 1.1);
          const a = angle[i];
          const k = Math.round(((a % Math.PI) + Math.PI) % Math.PI / (Math.PI / 8)) % 8;
          G[i] = DIR[k];
          hsv(hueBase + Math.cos(a) * 0.08, 0.55, 1, rgb);
          const c = i * 3;
          C[c] = rgb[0]; C[c + 1] = rgb[1]; C[c + 2] = rgb[2];
        }
        if (whale >= 0) drawWhale(grid, ctx.aspect, wx, wy, wsize, wdir, whale);
      },
    };
  },
};

/** A whale silhouette as negative space in the currents, with a faint luminous outline. */
function drawWhale(grid: { cols: number; rows: number; v: Float32Array; glyph: Uint32Array; col: Float32Array }, aspect: number, cx: number, cy: number, size: number, dir: number, time: number) {
  const fade = clamp(time / 6) * clamp((90 - time) / 6);
  const { cols, rows, v, glyph, col } = grid;
  const L = size; // body length in square units
  const x0 = Math.floor(cx - (L * 0.8) / aspect), x1 = Math.ceil(cx + (L * 0.8) / aspect);
  const y0 = Math.floor(cy - L * 0.35), y1 = Math.ceil(cy + L * 0.35);
  const tailBeat = Math.sin(time * 0.9) * 0.08;
  for (let y = Math.max(0, y0); y <= Math.min(rows - 1, y1); y++) {
    for (let x = Math.max(0, x0); x <= Math.min(cols - 1, x1); x++) {
      // local coords: u along body (-0.5 tail .. 0.5 head), w across
      const u = (((x - cx) * aspect) / L) * dir;
      const w = (y - cy) / L;
      let inside = 0;
      if (u > -0.42 && u < 0.5) {
        // body: thick near the head, tapering to the tail stock
        const s = (u + 0.42) / 0.92;
        const half = 0.13 * Math.sin(Math.min(1, s * 1.15) * Math.PI * 0.5 + 0.15) * (u > 0.38 ? Math.sqrt(Math.max(0, (0.5 - u) / 0.12)) : 1);
        const bend = tailBeat * Math.max(0, -u) * 2.5;
        const d = Math.abs(w - bend + (u > 0.1 ? 0.02 : 0)) - half;
        inside = d < 0 ? 1 : d < 0.025 ? 0.5 : 0;
        // pectoral fin
        if (!inside && u > 0.05 && u < 0.2 && w > 0.08 && w < 0.2 && w - 0.08 < (0.2 - u) * 0.9) inside = 1;
      } else if (u <= -0.42 && u > -0.6) {
        // flukes
        const bend = tailBeat * 1.2;
        const span = (-0.42 - u) * 1.3 + 0.01;
        const d = Math.abs(Math.abs(w - bend) - span * 0.6) - 0.025;
        inside = d < 0 && Math.abs(w - bend) < span ? 1 : 0;
      }
      if (!inside) continue;
      const i = y * cols + x;
      if (inside === 1) {
        v[i] *= 1 - 0.85 * fade;
        if (v[i] < 0.05) glyph[i] = 0;
      } else {
        v[i] = Math.max(v[i], 0.45 * fade);
        glyph[i] = '.'.codePointAt(0)!;
        const c = i * 3;
        col[c] = 0.7; col[c + 1] = 0.9; col[c + 2] = 1;
      }
    }
  }
}

export default flowfield;
