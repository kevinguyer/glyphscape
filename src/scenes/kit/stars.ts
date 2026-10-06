import type { Grid } from '../../engine/grid';
import type { Rng } from '../../engine/rng';
import { cp } from './util';

const STAR_GLYPHS = ['.', '·', '+', '*', '✦'].map(cp);

export interface StarOptions {
  /** Stars per cell (0.01 is a sparse sky, 0.04 a rich one). */
  density?: number;
  /** Only place stars above this row fraction (e.g. leave room for a horizon). */
  maxY?: number;
  /** Pole the sky rotates around, in cell coordinates. Defaults to above the top-left. */
  pole?: [number, number];
  /** Probability (0..1) of keeping a star at a position, e.g. to trace the Milky Way. */
  accept?: (x: number, y: number) => number;
  /** Scales star magnitudes (use < 1 for a faint background layer). */
  magScale?: number;
}

/**
 * A fixed sky of twinkling stars with a realistic brightness distribution (many faint, few
 * bright), optional slow rotation around a pole, and scintillation that grows toward the horizon.
 */
export class StarField {
  x = new Float32Array(0);
  y = new Float32Array(0);
  private r = new Float32Array(0); // polar radius around the pole
  private a = new Float32Array(0); // polar angle
  private mag = new Float32Array(0);
  private tint = new Float32Array(0);
  private ph = new Float32Array(0);
  private px = 0;
  private py = 0;
  count = 0;

  init(rng: Rng, cols: number, rows: number, aspect: number, o: StarOptions = {}) {
    const maxY = o.maxY ?? 1;
    // 1.5x accounts for the off-screen margin that rotates into view
    const n = Math.floor(cols * rows * maxY * 1.5 * (o.density ?? 0.02));
    [this.px, this.py] = o.pole ?? [cols * 0.15, -rows * 0.6];
    this.x = new Float32Array(n); this.y = new Float32Array(n);
    this.r = new Float32Array(n); this.a = new Float32Array(n);
    this.mag = new Float32Array(n); this.tint = new Float32Array(n); this.ph = new Float32Array(n);
    // Scatter uniformly over the sky plus a margin that rotates into view, then store each
    // star in polar form around the pole.
    let k = 0;
    for (let tries = 0; k < n && tries < n * 20; tries++) {
      const sx = rng.range(-0.25, 1.25) * cols, sy = rng.range(-0.25, maxY) * rows;
      if (o.accept && rng() > o.accept(sx, sy)) continue;
      const dx = (sx - this.px) * aspect, dy = sy - this.py;
      this.r[k] = Math.hypot(dx, dy);
      this.a[k] = Math.atan2(dy, dx);
      this.mag[k] = Math.pow(rng(), 7) * (o.magScale ?? 1);
      this.tint[k] = rng();
      this.ph[k] = rng() * 100;
      k++;
    }
    this.count = k;
  }

  /**
   * Draw the stars. `rotation` is the sky angle in radians; `occluded` hides stars behind
   * foreground; `dim` (0..1 at a cell) fades stars behind bright things like clouds.
   */
  render(grid: Grid, t: number, aspect: number, rotation = 0, opts: {
    brightness?: number;
    horizon?: number;
    occluded?: (x: number, y: number) => boolean;
  } = {}) {
    const B = opts.brightness ?? 1;
    const horizon = opts.horizon ?? grid.rows;
    const V = grid.v;
    for (let i = 0; i < this.count; i++) {
      const a = this.a[i] + rotation;
      const x = this.px + (Math.cos(a) * this.r[i]) / aspect;
      const y = this.py + Math.sin(a) * this.r[i];
      this.x[i] = x; this.y[i] = y;
      if (x < 0 || y < 0 || x >= grid.cols || y >= horizon) continue;
      if (opts.occluded?.(x, y)) continue;
      const m = this.mag[i];
      // scintillation: stronger and faster near the horizon, always well below 3 Hz
      const low = Math.max(0, y / horizon - 0.55) * 2;
      const tw = 1 - (0.12 + 0.3 * low) * (0.5 + 0.5 * Math.sin(t * (0.8 + low * 1.4) + this.ph[i]));
      const b = (0.2 + 0.8 * m) * tw * B;
      const ci = (y | 0) * grid.cols + (x | 0);
      if (b <= V[ci]) continue;
      const tt = this.tint[i];
      const r = tt < 0.25 ? 0.75 : 1, g = tt > 0.85 ? 0.82 : 0.92, bl = tt > 0.85 ? 0.7 : tt < 0.25 ? 1 : 0.9;
      grid.set(x, y, b, r, g, bl, STAR_GLYPHS[Math.min(4, Math.floor(m * 5.2))]);
    }
  }
}
