import type { Grid } from '../../engine/grid';
import { clamp, hsv, type RGB } from '../../engine/math';
import { hash2 } from '../../engine/rng';
import { cp, lineGlyph } from './util';

/** bell: classic medusa. moon: wide, flat, four glowing rings. comb: ctenophore with rainbow comb rows. */
export type JellyKind = 'bell' | 'moon' | 'comb';

export interface Jelly {
  kind: JellyKind;
  x: number;
  y: number;
  /** Bell radius in rows. */
  size: number;
  phase: number;
  /** Seconds per swim stroke. */
  period: number;
  color: RGB;
  /** Sideways drift in cells per second. */
  drift: number;
}

/** 0..1 bell contraction at the jelly's current phase (comb jellies glide and never contract). */
export function jellySqueeze(j: Jelly) {
  if (j.kind === 'comb') return 0;
  const p = (((j.phase % j.period) + j.period) % j.period) / j.period;
  return p < 0.25 ? Math.sin((p / 0.25) * Math.PI) : 0;
}

/**
 * Advance a jelly: it rises on each contraction and sinks gently in between (comb jellies
 * glide steadily). `climb` biases the motion, e.g. a migration upward. Returns the squeeze.
 */
export function swimJelly(j: Jelly, dt: number, opts: { kick?: number; current?: number; climb?: number; t?: number } = {}) {
  j.phase += dt * (1 + (opts.kick ?? 0) * 0.5);
  const sq = jellySqueeze(j);
  if (j.kind === 'comb') j.y -= dt * (0.35 + (opts.climb ?? 0)) * j.size * 0.4;
  else j.y -= sq * dt * 1.3 * j.size + (opts.climb ?? 0) * dt * j.size * 0.3;
  j.y += dt * 0.25;
  j.x += (j.drift + Math.sin((opts.t ?? 0) * 0.1 + j.period) * 0.3 * (opts.current ?? 0)) * dt;
  return sq;
}

const rgb: RGB = [0, 0, 0];

/** Draw a jelly. `glow` scales brightness; `fade` dims distant ones. */
export function drawJelly(grid: Grid, j: Jelly, t: number, aspect: number, glow: number, fade = 1) {
  const g = glow * fade;
  if (j.kind === 'comb') return drawComb(grid, j, t, aspect, g);
  const sq = jellySqueeze(j);
  const moon = j.kind === 'moon';
  const R = j.size * (moon ? 1.3 : 1) * (1 - 0.25 * sq);
  const H = j.size * (moon ? 0.45 : 0.8) * (1 + 0.35 * sq);
  const rx = R / aspect;
  const col = j.color;
  for (let yy = -Math.ceil(H); yy <= 0; yy++) {
    for (let xx = -Math.ceil(rx); xx <= Math.ceil(rx); xx++) {
      const d = Math.hypot((xx * aspect) / R, yy / H);
      if (d > 1) continue;
      const rim = d > 0.75 || yy === 0;
      let b = rim ? 0.45 + 0.3 * sq : 0.16 + 0.1 * Math.sin(xx * 1.5 + t);
      let glyph = rim ? cp(yy === 0 ? '~' : xx < 0 ? '(' : xx > 0 ? ')' : '-') : 0;
      if (moon && !rim) {
        // four horseshoe-shaped gonads glowing through the bell
        const ax = (xx * aspect) / R, ay = (yy + H * 0.45) / H;
        const ring = Math.abs(Math.hypot(Math.abs(ax) - 0.35, ay) - 0.18) < 0.09;
        if (ring) { b = 0.5 + 0.2 * sq; glyph = cp('o'); }
      }
      grid.max(j.x + xx, j.y + yy, clamp(b * g), col[0], col[1], col[2], glyph);
    }
  }
  if (moon) {
    // a short fringe of tentacles all along the rim
    for (let xx = -Math.floor(rx); xx <= Math.floor(rx); xx += 2) {
      const sway = Math.sin(t * 1.5 + xx * 0.7 + j.phase) * 0.4;
      grid.max(j.x + xx + sway, j.y + 1, clamp(0.2 * g), col[0], col[1], col[2], cp('\''));
    }
    return;
  }
  // tentacles trail and ripple behind the bell, swinging wider toward their tips
  const nT = 3;
  for (let k = 0; k < nT; k++) {
    let x = j.x + (k - (nT - 1) / 2) * rx * 0.7;
    const len = j.size * (2.6 + k * 0.5);
    for (let s = 1; s < len; s++) {
      const f = s / len;
      const nx = x + Math.sin(t * 1.3 + k * 2 + s * 0.5 + j.phase) * (0.2 + 0.5 * f);
      if (hash2(k, s, 3) < 0.15 * f) { x = nx; continue; } // thin, broken toward the end
      grid.max(nx, j.y + s, clamp((0.24 - f * 0.18) * g), col[0], col[1], col[2], lineGlyph(nx - x, 1, aspect));
      x = nx;
    }
  }
}

/** Comb jelly: a translucent oval whose eight comb rows ripple with travelling rainbow light. */
function drawComb(grid: Grid, j: Jelly, t: number, aspect: number, g: number) {
  const R = j.size * 0.7, H = j.size * 1.2;
  const rx = R / aspect;
  for (let yy = -Math.ceil(H); yy <= Math.ceil(H); yy++) {
    for (let xx = -Math.ceil(rx); xx <= Math.ceil(rx); xx++) {
      const ax = (xx * aspect) / R, ay = yy / H;
      const d = Math.hypot(ax, ay);
      if (d > 1) continue;
      // comb rows run top to bottom along meridians of the body
      const meridian = Math.abs(Math.sin(Math.asin(clamp(ax / Math.sqrt(Math.max(0.05, 1 - ay * ay)), -1, 1)) * 4));
      const onRow = meridian > 0.82;
      if (onRow) {
        hsv(ay * 0.6 - t * 0.35 + j.phase, 0.75, 1, rgb);
        const shimmer = 0.5 + 0.5 * Math.sin(yy * 1.8 - t * 4 + j.phase);
        grid.max(j.x + xx, j.y + yy, clamp((0.25 + 0.4 * shimmer) * g), rgb[0], rgb[1], rgb[2], cp(':'));
      } else {
        grid.max(j.x + xx, j.y + yy, clamp((d > 0.85 ? 0.22 : 0.07) * g), 0.7, 0.85, 1, d > 0.85 ? cp(xx < 0 ? '(' : xx > 0 ? ')' : '-') : 0);
      }
    }
  }
  // two long, fine tentacles
  for (let k = -1; k <= 1; k += 2) {
    let x = j.x + k * rx * 0.3;
    for (let s = 1; s < j.size * 4; s++) {
      const nx = x + Math.sin(t * 0.9 + s * 0.35 + k) * 0.3 + k * 0.08;
      grid.max(nx, j.y + H + s, clamp(0.12 * g * (1 - s / (j.size * 4))), 0.7, 0.85, 1, lineGlyph(nx - x, 1, aspect));
      x = nx;
    }
  }
}
