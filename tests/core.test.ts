import { describe, expect, it } from 'vitest';
import { LowResField } from '../src/engine/field';
import { fexp, fsin } from '../src/engine/math';
import { createNoise } from '../src/engine/noise';
import { createRng } from '../src/engine/rng';
import { paramDefaults, SceneRunner, SILENT_AUDIO } from '../src/engine/runner';
import { SCENES } from '../src/scenes';

describe('rng', () => {
  it('is deterministic for a seed', () => {
    const a = createRng(8213), b = createRng(8213);
    const xs = Array.from({ length: 50 }, () => a());
    expect(Array.from({ length: 50 }, () => b())).toEqual(xs);
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });

  it('differs across seeds', () => {
    expect(createRng(1)()).not.toEqual(createRng(2)());
  });
});

describe('noise', () => {
  it('is seeded and bounded', () => {
    const n = createNoise(42), m = createNoise(42);
    for (let i = 0; i < 200; i++) {
      const x = i * 0.37, y = i * 0.11;
      expect(n.n3(x, y, 0.5)).toEqual(m.n3(x, y, 0.5));
      expect(Math.abs(n.n2(x, y))).toBeLessThanOrEqual(1.01);
      expect(Math.abs(n.fbm3(x, y, 1))).toBeLessThanOrEqual(1.01);
    }
  });
});

describe('fast math', () => {
  it('approximates sin and exp closely', () => {
    for (let x = -20; x < 20; x += 0.173) expect(Math.abs(fsin(x) - Math.sin(x))).toBeLessThan(0.003);
    for (let x = -15; x <= 0; x += 0.0731) expect(Math.abs(fexp(x) - Math.exp(x))).toBeLessThan(1e-4);
  });
});

describe('LowResField', () => {
  it('interpolates a linear field exactly', () => {
    const f = new LowResField(4, 1);
    f.update(40, 20, (x, y) => x * 0.5 + y);
    expect(f.sample(10, 6)).toBeCloseTo(11, 5);
    expect(f.sample(21, 13)).toBeCloseTo(23.5, 5);
  });
});

describe('scenes', () => {
  const run = (id: string, seed: number) => {
    const def = SCENES.find((s) => s.id === id)!;
    const r = new SceneRunner(def, seed, paramDefaults(def), 80, 30, 0.6);
    for (let i = 0; i < 60; i++) r.tick(1 / 30, SILENT_AUDIO, false);
    return r.grid;
  };

  for (const def of SCENES) {
    it(`${def.id} renders deterministically from its seed`, () => {
      const a = run(def.id, 1234), b = run(def.id, 1234);
      expect(Array.from(a.v)).toEqual(Array.from(b.v));
      expect(Array.from(a.glyph)).toEqual(Array.from(b.glyph));
      // Every value is a valid brightness, and something is on screen.
      expect(a.v.every((v) => v >= 0 && v <= 1 && Number.isFinite(v))).toBe(true);
      expect(a.v.some((v) => v > 0.05)).toBe(true);
    });

    it(`${def.id} survives a resize and its rare event`, () => {
      const r = new SceneRunner(def, 7, paramDefaults(def), 60, 20, 0.6);
      r.tick(1 / 30, SILENT_AUDIO, false);
      r.resize(120, 45, 0.6);
      r.triggerEvent();
      for (let i = 0; i < 90; i++) r.tick(1 / 30, SILENT_AUDIO, false);
      expect(r.grid.cols).toBe(120);
      expect(r.grid.v.every((v) => Number.isFinite(v))).toBe(true);
    });
  }
});
