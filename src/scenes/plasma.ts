import { LowResField } from '../engine/field';
import { fsin, hsv, type RGB } from '../engine/math';
import type { SceneDef } from '../engine/types';

/** Classic sine-interference plasma, slowed down and domain-warped so it never quite repeats. */
const plasma: SceneDef = {
  id: 'plasma',
  name: 'Plasma',
  family: 'procedural',
  blurb: 'Sine-interference plasma in glyph ramps',
  recommended: { style: 'vapor' },
  defaultSeed: 5150,
  params: [
    { key: 'speed', label: 'Speed', min: 0.1, max: 3, default: 0.6 },
    { key: 'scale', label: 'Scale', min: 0.3, max: 3, default: 1 },
    { key: 'warp', label: 'Turbulence', min: 0, max: 1, default: 0.45 },
  ],
  create() {
    let t = 0;
    let phase = 0;
    let ripple = -1; // rare event: a slow ring that crosses the field
    let rx = 0, ry = 0;
    const k = new Float32Array(6);
    const rgb: RGB = [0, 0, 0];
    const warpX = new LowResField(2, 2), warpY = new LowResField(2, 2);
    return {
      init(ctx) {
        t = ctx.rng() * 1000;
        for (let i = 0; i < k.length; i++) k[i] = ctx.rng.range(0.6, 1.4);
      },
      update(dt, audio, ctx) {
        t += dt * ctx.params.speed;
        phase += audio.beat * dt * 2.2;
        if (ripple >= 0) {
          ripple += dt * 0.12;
          if (ripple > 1.6) ripple = -1;
        }
      },
      event(ctx) {
        ripple = 0;
        rx = ctx.rng();
        ry = ctx.rng();
      },
      render(grid, ctx) {
        const { cols, rows, aspect, noise } = ctx;
        const s = 0.17 / ctx.params.scale;
        const warp = ctx.params.warp * 3;
        const cx = cols * aspect * 0.5, cy = rows * 0.5;
        const tt = t * 0.35;
        if (warp > 0) {
          warpX.update(cols, rows, (x, y) => noise.n3(x * aspect * s * 0.35, y * s * 0.35, tt * 0.25));
          warpY.update(cols, rows, (x, y) => noise.n3(x * aspect * s * 0.35 + 31, y * s * 0.35, tt * 0.25));
        }
        const hueShift = t * 0.01;
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            let px = x * aspect * s;
            let py = y * s;
            if (warp > 0) {
              px += warpX.sample(x, y) * warp;
              py += warpY.sample(x, y) * warp;
            }
            const dx = px - cx * s + fsin(tt * 0.31) * 3;
            const dy = py - cy * s + Math.cos(tt * 0.27) * 2;
            let v = fsin(px * k[0] + tt + phase)
              + fsin((py * k[1] - tt * 0.8) * 1.1)
              + fsin((px * k[2] + py * k[3]) * 0.7 + tt * 1.2)
              + fsin(Math.sqrt(dx * dx + dy * dy) * k[4] * 1.4 - tt * 1.5 + phase);
            v *= 0.25; // -1..1
            let b = 0.5 + 0.5 * fsin(v * Math.PI * 1.4 + tt * 0.2);
            b = Math.pow(b, 1.35) * 0.88 + 0.02;
            if (ripple >= 0) {
              const rdx = (x / cols - rx) * (cols * aspect) / rows;
              const rdy = y / rows - ry;
              const d = Math.sqrt(rdx * rdx + rdy * rdy);
              const ring = Math.exp(-Math.pow((d - ripple) * 9, 2)) * (1 - ripple / 1.6);
              b = Math.min(1, b + ring * 0.45);
            }
            hsv(v * 0.35 + hueShift + 0.55, 0.7, 1, rgb);
            const i = y * cols + x;
            grid.v[i] = b * 0.92;
            const c = i * 3;
            grid.col[c] = rgb[0]; grid.col[c + 1] = rgb[1]; grid.col[c + 2] = rgb[2];
          }
        }
      },
    };
  },
};

export default plasma;
