import { Grid } from './grid';
import { createNoise } from './noise';
import { createRng } from './rng';
import type { AudioFrame, SceneContext, SceneDef, SceneInstance } from './types';

export const SILENT_AUDIO: AudioFrame = {
  bands: new Float32Array(4),
  level: 0,
  beat: 0,
  beatPhase: 0,
  active: false,
};

export function paramDefaults(def: SceneDef, overrides?: Record<string, number>) {
  const p: Record<string, number> = {};
  for (const prm of def.params) p[prm.key] = overrides?.[prm.key] ?? prm.default;
  return p;
}

/** Owns one running scene instance, its context, and its grid buffer. */
export class SceneRunner {
  inst: SceneInstance;
  grid: Grid;
  ctx: SceneContext;
  private nextEvent: number;

  constructor(
    readonly def: SceneDef,
    readonly seed: number,
    params: Record<string, number>,
    cols: number,
    rows: number,
    aspect: number,
    opts: { reducedMotion?: boolean; thumbnail?: boolean } = {},
  ) {
    this.inst = def.create();
    this.grid = new Grid(cols, rows);
    this.ctx = {
      cols, rows, aspect, seed,
      rng: createRng(seed),
      noise: createNoise(seed),
      params,
      time: 0,
      audio: SILENT_AUDIO,
      reducedMotion: !!opts.reducedMotion,
      thumbnail: !!opts.thumbnail,
    };
    this.inst.init(this.ctx);
    this.nextEvent = this.scheduleEvent();
  }

  /** Rare events: exponential waiting time, mean ~50 minutes, never in the first few. */
  private scheduleEvent() {
    const r = Math.random();
    return this.ctx.time + 240 + -Math.log(1 - r * 0.999) * 2700;
  }

  resize(cols: number, rows: number, aspect: number) {
    if (cols === this.ctx.cols && rows === this.ctx.rows && aspect === this.ctx.aspect) return;
    this.grid = new Grid(cols, rows);
    this.ctx.cols = cols;
    this.ctx.rows = rows;
    this.ctx.aspect = aspect;
    // Re-init with the same seed so the look is preserved.
    this.ctx.rng = createRng(this.seed);
    this.inst.init(this.ctx);
  }

  tick(dt: number, audio: AudioFrame, rareEvents: boolean) {
    this.ctx.audio = audio;
    this.ctx.time += dt;
    this.inst.update(dt, audio, this.ctx);
    if (rareEvents && this.inst.event && this.ctx.time >= this.nextEvent) {
      this.inst.event(this.ctx);
      this.nextEvent = this.scheduleEvent();
    }
    this.grid.clear();
    this.inst.render(this.grid, this.ctx);
  }

  triggerEvent() {
    this.inst.event?.(this.ctx);
  }
}
