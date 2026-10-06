import type { Grid } from '../../engine/grid';
import { clamp } from '../../engine/math';
import type { Rng } from '../../engine/rng';
import { lineGlyph, pulse } from './util';

/** Falling rain streaks, slanted by wind. Pooled; cheap enough for thousands. */
export class RainStreaks {
  private x = new Float32Array(0);
  private y = new Float32Array(0);
  private v = new Float32Array(0);
  private len = new Float32Array(0);
  private cols = 0;
  private rows = 0;
  active = 0;

  constructor(private max = 1200) {}

  init(rng: Rng, cols: number, rows: number) {
    this.cols = cols; this.rows = rows;
    const n = this.max;
    this.x = new Float32Array(n); this.y = new Float32Array(n); this.v = new Float32Array(n); this.len = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      this.x[i] = rng() * cols; this.y[i] = rng() * rows;
      this.v[i] = rng.range(20, 36); this.len[i] = rng.range(1, 3.5);
    }
  }

  /** intensity 0..1 scales how many streaks fall; wind is horizontal speed relative to fall. */
  update(dt: number, rng: Rng, intensity: number, wind: number, top = 0, bottom = this.rows) {
    this.active = Math.floor(this.max * clamp(intensity) * clamp((this.cols * this.rows) / 18000, 0.3, 1));
    for (let i = 0; i < this.active; i++) {
      this.y[i] += this.v[i] * dt;
      this.x[i] += this.v[i] * wind * dt;
      if (this.y[i] > bottom + 3) {
        this.y[i] = top - rng() * 6;
        this.x[i] = rng() * (this.cols + 20) - 10;
      }
      if (this.x[i] < -12) this.x[i] += this.cols + 24;
      else if (this.x[i] > this.cols + 12) this.x[i] -= this.cols + 24;
    }
  }

  render(grid: Grid, aspect: number, wind: number, bright: number, color: [number, number, number], lit?: (x: number, y: number) => number) {
    const g = lineGlyph(wind, 1, aspect);
    for (let i = 0; i < this.active; i++) {
      const len = this.len[i] | 0;
      for (let k = 0; k <= len; k++) {
        const y = this.y[i] - k, x = this.x[i] - k * wind;
        const b = bright * (1 - k / (len + 1)) + (lit ? lit(x, y) * 0.5 : 0);
        grid.max(x, y, b, color[0], color[1], color[2], g);
      }
    }
  }
}

interface Pulse { start: number; amp: number }
interface BoltCell { x: number; y: number; w: number; g: number }

/**
 * Lightning with a safety-first envelope: every flash is a smooth pulse (no hard cuts) and
 * restrikes are spaced at least 0.4 s apart, keeping any flicker under 3 Hz. Reduced motion
 * softens and slows everything further.
 */
export class Lightning {
  /** Bolt path cells; empty for in-cloud ("sheet") flashes. */
  bolt: BoltCell[] = [];
  /** Center of the current flash, used to light nearby cloud and ground. */
  cx = 0;
  cy = 0;
  radius = 20;
  private pulses: Pulse[] = [];
  private t = 0;
  reduced = false;

  get rise() {
    return this.reduced ? 0.35 : 0.12;
  }

  get decay() {
    return this.reduced ? 1.2 : 0.7;
  }

  /** Current flash level, 0..1. */
  level() {
    let v = 0;
    for (const p of this.pulses) v = Math.max(v, p.amp * pulse(this.t - p.start, this.rise, this.decay));
    return (this.reduced ? 0.35 : 1) * v;
  }

  get busy() {
    return this.pulses.some((p) => this.t - p.start < this.rise + this.decay * 4);
  }

  update(dt: number) {
    this.t += dt;
    this.pulses = this.pulses.filter((p) => this.t - p.start < this.rise + this.decay * 6);
    if (!this.busy) this.bolt.length = 0;
  }

  private addPulses(rng: Rng, amp: number, restrikes: number) {
    this.pulses.push({ start: this.t, amp });
    let at = this.t;
    for (let k = 0; k < restrikes && !this.reduced; k++) {
      at += rng.range(0.4, 0.75); // never faster than 2.5 Hz
      this.pulses.push({ start: at, amp: amp * rng.range(0.45, 0.8) });
    }
  }

  /** A cloud-to-ground bolt from (x0, y0) down to the ground row. */
  strike(rng: Rng, aspect: number, x0: number, y0: number, ground: (x: number) => number, opts: { branchiness?: number; amp?: number; restrikes?: number; spread?: number } = {}) {
    this.bolt = [];
    const branchiness = opts.branchiness ?? 1;
    const walk = (x: number, y: number, w: number, depth: number, drift: number, maxLen: number) => {
      let n = 0;
      while (n++ < maxLen) {
        const ny = y + 1;
        const nx = x + (rng() - 0.5) * 1.7 + drift + (rng() < 0.08 ? (rng() - 0.5) * 4 : 0);
        this.bolt.push({ x: nx, y: ny, w, g: lineGlyph(nx - x, 1, aspect) });
        x = nx; y = ny;
        if (y >= ground(x)) break;
        if (depth < 2 && rng() < 0.06 * branchiness) {
          walk(x, y, w * 0.5, depth + 1, (rng() < 0.5 ? -1 : 1) * rng.range(0.4, 1.1), rng.int(4, 16));
        }
      }
    };
    walk(x0, y0, 1, 0, (rng() - 0.5) * 0.4, 400);
    this.cx = x0;
    this.cy = y0;
    this.radius = opts.spread ?? 24;
    this.addPulses(rng, opts.amp ?? 1, opts.restrikes ?? rng.int(0, 3));
  }

  /** A horizontal "spider" bolt that crawls along the cloud base. */
  crawl(rng: Rng, aspect: number, x0: number, y: number, length: number, dir: number) {
    this.bolt = [];
    let x = x0, yy = y;
    for (let k = 0; k < length; k++) {
      const nx = x + dir * rng.range(0.6, 1.4);
      const ny = yy + (rng() - 0.5) * 0.9;
      this.bolt.push({ x: nx, y: ny, w: 0.75, g: lineGlyph(nx - x, ny - yy, aspect) });
      if (rng() < 0.12) {
        let bx = nx, by = ny;
        for (let j = 0; j < rng.int(2, 7); j++) {
          const bnx = bx + dir * rng.range(0, 1), bny = by + rng.range(0.6, 1.1);
          this.bolt.push({ x: bnx, y: bny, w: 0.4, g: lineGlyph(bnx - bx, 1, aspect) });
          bx = bnx; by = bny;
        }
      }
      x = nx; yy = ny;
    }
    this.cx = x0 + (dir * length) / 2;
    this.cy = y;
    this.radius = length * 0.7;
    this.addPulses(rng, 0.85, 1);
  }

  /** A flash hidden inside the clouds: no bolt, just a soft glow. */
  sheet(rng: Rng, x: number, y: number, radius: number, amp = 0.6) {
    if (this.busy) return;
    this.bolt = [];
    this.cx = x; this.cy = y; this.radius = radius;
    this.addPulses(rng, amp, rng.int(0, 2));
  }

  /** Illumination at a cell from the current flash (0..1). */
  light(x: number, y: number, aspect: number) {
    const l = this.level();
    if (l < 0.005) return 0;
    const dx = (x - this.cx) * aspect, dy = y - this.cy;
    return l * Math.exp(-(dx * dx + dy * dy) / (this.radius * this.radius));
  }

  renderBolt(grid: Grid, glowColor: [number, number, number] = [0.75, 0.8, 1]) {
    const l = this.level();
    if (l < 0.02 || !this.bolt.length) return;
    for (const c of this.bolt) {
      const b = clamp(l * (0.5 + 0.5 * c.w) * 1.1);
      grid.max(c.x - 1, c.y, b * 0.25, glowColor[0], glowColor[1], glowColor[2]);
      grid.max(c.x + 1, c.y, b * 0.25, glowColor[0], glowColor[1], glowColor[2]);
      grid.max(c.x, c.y, b, 0.95, 0.95, 1, c.g);
    }
  }
}
