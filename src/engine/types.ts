import type { Grid } from './grid';
import type { Noise } from './noise';
import type { Rng } from './rng';

/** What the audio pipeline exposes to scenes. All values 0..1 and gently smoothed. */
export interface AudioFrame {
  /** bass, low mid, high mid, treble */
  bands: Float32Array;
  level: number;
  /** 1 on an onset, decaying smoothly to 0. */
  beat: number;
  /** 0..1 progress between estimated beats. */
  beatPhase: number;
  active: boolean;
}

export interface SceneParam {
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
  step?: number;
}

export type ColorMode = 'mono' | 'duotone' | 'gradient' | 'native';
export type SceneFamily = 'procedural' | 'particle' | 'simulation' | 'scenic' | 'hand-authored' | 'secret';

export interface SceneContext {
  cols: number;
  rows: number;
  /** Cell width / cell height. Multiply x distances by this to work in square units. */
  aspect: number;
  seed: number;
  rng: Rng;
  noise: Noise;
  params: Record<string, number>;
  /** Seconds of scene time (already scaled by reduced-motion). */
  time: number;
  audio: AudioFrame;
  reducedMotion: boolean;
  /** True for the small console thumbnails, so scenes can skip expensive extras. */
  thumbnail: boolean;
}

export interface SceneInstance {
  init(ctx: SceneContext): void;
  update(dt: number, audio: AudioFrame, ctx: SceneContext): void;
  render(grid: Grid, ctx: SceneContext): void;
  /** Kick off this scene's rare event (shooting star, lightning, disruption...). */
  event?(ctx: SceneContext): void;
}

export interface SceneDef {
  id: string;
  name: string;
  family: SceneFamily;
  blurb: string;
  /** Style (and optional color mode) to use when the style is set to Auto. */
  recommended: { style: string; colorMode?: ColorMode };
  params: SceneParam[];
  /** Curated seed so the first launch looks good. */
  defaultSeed: number;
  hidden?: boolean;
  create(): SceneInstance;
}
