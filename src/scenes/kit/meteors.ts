import type { Grid } from '../../engine/grid';
import { clamp } from '../../engine/math';
import { cp, lineGlyph } from './util';

export interface MeteorSpec {
  x: number;
  y: number;
  /** Velocity in cells per second. */
  vx: number;
  vy: number;
  /** Seconds the meteor burns. */
  life: number;
  /** Peak brightness 0..1. */
  bright?: number;
  /** Tail length in seconds of travel. */
  tail?: number;
  /** Head and tail colors. */
  head?: [number, number, number];
  color?: [number, number, number];
  /** 0..1: how strong a persistent glowing train it leaves. */
  train?: number;
}

interface Meteor extends Required<MeteorSpec> { age: number; alive: boolean }
interface Train { x0: number; y0: number; x1: number; y1: number; age: number; life: number; amt: number; seed: number }

const HEAD = cp('*'), BIG = cp('@'), DOT = cp('.');

/**
 * Pooled meteors (shooting stars, fireballs) with fading tails and optional persistent trains
 * that linger and drift after a bright meteor burns out.
 */
export class Meteors {
  private pool: Meteor[] = [];
  private trains: Train[] = [];

  constructor(private max = 24) {}

  get active() {
    return this.pool.some((m) => m.alive);
  }

  spawn(s: MeteorSpec) {
    let m = this.pool.find((p) => !p.alive);
    if (!m) {
      if (this.pool.length >= this.max) return;
      m = {} as Meteor;
      this.pool.push(m);
    }
    Object.assign(m, {
      bright: 0.95, tail: 0.25, head: [1, 1, 0.95], color: [0.85, 0.9, 1], train: 0,
      ...s, age: 0, alive: true,
    });
  }

  clear() {
    this.pool.forEach((m) => (m.alive = false));
    this.trains.length = 0;
  }

  update(dt: number) {
    for (const m of this.pool) {
      if (!m.alive) continue;
      m.age += dt;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.age >= m.life) {
        m.alive = false;
        if (m.train > 0) {
          const len = Math.hypot(m.vx, m.vy) * Math.min(m.life, 1.2);
          const k = len / Math.hypot(m.vx, m.vy);
          this.trains.push({ x0: m.x - m.vx * k, y0: m.y - m.vy * k, x1: m.x, y1: m.y, age: 0, life: 6 + 14 * m.train, amt: m.train, seed: m.x * 13.1 + m.y });
          if (this.trains.length > 6) this.trains.shift();
        }
      }
    }
    for (const tr of this.trains) tr.age += dt;
    this.trains = this.trains.filter((tr) => tr.age < tr.life);
  }

  render(grid: Grid, aspect: number) {
    for (const tr of this.trains) {
      // A train glows faintly, fades, and is slowly bent by upper-atmosphere winds.
      const f = 1 - tr.age / tr.life;
      const steps = Math.ceil(Math.hypot(tr.x1 - tr.x0, tr.y1 - tr.y0));
      for (let k = 0; k <= steps; k++) {
        const u = k / Math.max(1, steps);
        const bend = Math.sin(u * 5 + tr.seed) * tr.age * 0.12;
        const x = tr.x0 + (tr.x1 - tr.x0) * u + bend;
        const y = tr.y0 + (tr.y1 - tr.y0) * u + bend * 0.4 + tr.age * 0.05;
        grid.max(x, y, 0.32 * tr.amt * f * f * (0.6 + 0.4 * Math.sin(u * 9 + tr.seed)), 0.55, 0.9, 0.75, DOT);
      }
    }
    for (const m of this.pool) {
      if (!m.alive) continue;
      // fast, smooth rise then a fade over the second half of its life
      const env = clamp(m.age / 0.12) * clamp((m.life - m.age) / (m.life * 0.6));
      const speed = Math.hypot(m.vx, m.vy);
      const len = Math.max(2, Math.ceil(speed * m.tail));
      const ux = m.vx / speed, uy = m.vy / speed;
      const glyph = lineGlyph(m.vx, m.vy, aspect);
      for (let k = 0; k < len; k++) {
        const f = k / len;
        const b = m.bright * env * Math.pow(1 - f, 1.4);
        if (b < 0.03) break;
        const c = k === 0 ? m.head : m.color;
        grid.max(m.x - ux * k, m.y - uy * k, b, c[0], c[1], c[2], k === 0 ? (m.bright > 0.97 ? BIG : HEAD) : glyph);
      }
    }
  }
}
