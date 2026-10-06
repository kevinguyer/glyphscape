import type { Grid } from '../../engine/grid';
import { clamp } from '../../engine/math';
import type { Noise } from '../../engine/noise';
import type { Rng } from '../../engine/rng';
import { cp } from './util';

const DOT = cp('.'), MID = cp('·'), BRIGHT = cp('*');

export interface MoteDrift {
  /** Drift speed in cells per second along a slowly changing noise current. */
  drift: number;
  /** Constant vertical motion in cells per second (negative rises). */
  rise?: number;
  /** Keep motes between these rows. */
  top?: number;
  bottom?: number;
  /** Seconds for an excited mote to calm down (default 0.9). Spores glow longer than plankton. */
  calm?: number;
}

/**
 * Drifting glowing particles (plankton, spores, dust, embers) carried by a gentle noise current.
 * Each mote can be "excited" to flare up and then calm down, which is how plankton reacts when
 * something swims through it.
 */
export class Motes {
  x = new Float32Array(0);
  y = new Float32Array(0);
  glow = new Float32Array(0);
  private seed = new Float32Array(0);
  count = 0;
  private cols = 0;
  private top = 0;
  private bottom = 0;

  init(rng: Rng, cols: number, rows: number, count: number, top = 0, bottom = rows) {
    this.cols = cols; this.top = top; this.bottom = bottom;
    this.count = count;
    this.x = new Float32Array(count); this.y = new Float32Array(count);
    this.glow = new Float32Array(count); this.seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.x[i] = rng() * cols;
      this.y[i] = top + rng() * (bottom - top);
      this.seed[i] = rng() * 100;
    }
  }

  /** Place one mote at a point (e.g. a spore leaving a mushroom), recycling the oldest slot. */
  emit(x: number, y: number, glow = 1) {
    let best = 0, bestGlow = Infinity;
    for (let i = 0; i < this.count; i++) {
      if (this.glow[i] < bestGlow) { bestGlow = this.glow[i]; best = i; }
    }
    this.x[best] = x; this.y[best] = y; this.glow[best] = glow;
  }

  update(dt: number, noise: Noise, t: number, d: MoteDrift) {
    const top = d.top ?? this.top, bottom = d.bottom ?? this.bottom;
    const rise = d.rise ?? 0;
    const calm = Math.exp(-dt / (d.calm ?? 0.9));
    for (let i = 0; i < this.count; i++) {
      const x = this.x[i], y = this.y[i];
      const vx = noise.n3(x * 0.04, y * 0.06, t * 0.05 + this.seed[i] * 0.01) * d.drift;
      const vy = noise.n3(x * 0.04 + 40, y * 0.06, t * 0.05) * d.drift * 0.5 + rise;
      let nx = x + vx * dt, ny = y + vy * dt;
      if (nx < 0) nx += this.cols;
      else if (nx >= this.cols) nx -= this.cols;
      if (ny < top) ny += bottom - top;
      else if (ny >= bottom) ny -= bottom - top;
      this.x[i] = nx; this.y[i] = ny;
      this.glow[i] *= calm;
    }
  }

  /** Make motes within `radius` cells of (x, y) flare up. */
  excite(x: number, y: number, radius: number, amount: number, aspect: number) {
    const r2 = radius * radius;
    for (let i = 0; i < this.count; i++) {
      const dx = (this.x[i] - x) * aspect, dy = this.y[i] - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2) this.glow[i] = Math.min(1, this.glow[i] + amount * (1 - d2 / r2));
    }
  }

  render(grid: Grid, t: number, base: number, color: [number, number, number], flare: [number, number, number] = [0.85, 1, 1]) {
    for (let i = 0; i < this.count; i++) {
      const g = this.glow[i];
      const tw = 0.6 + 0.4 * Math.sin(t * (0.6 + (this.seed[i] % 1) * 0.8) + this.seed[i]);
      const v = clamp(base * tw + g * 0.85);
      if (v < 0.03) continue;
      const w = clamp(g * 1.5);
      grid.max(this.x[i], this.y[i], v,
        color[0] + (flare[0] - color[0]) * w, color[1] + (flare[1] - color[1]) * w, color[2] + (flare[2] - color[2]) * w,
        g > 0.55 ? BRIGHT : v > 0.25 ? MID : DOT);
    }
  }
}
