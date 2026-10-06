import type { StyledFrame } from './compositor';
import type { Atlas } from './glyphs';
import type { RGB } from './math';
import type { PostFx } from './styles';

export interface FrameUniforms {
  /** Interpolation between the previous and current simulation tick, 0..1. */
  alpha: number;
  post: PostFx;
  brightness: number;
  /** 0..1 warm shift (night mode / time of day). */
  warmth: number;
  /** Peak brightness cap, 1 = none. */
  peak: number;
  driftX: number;
  driftY: number;
  time: number;
  dt: number;
  edge: RGB;
}

export interface Layout {
  width: number;
  height: number;
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  /** Grid origin in device pixels (negative, so drift never reveals an edge). */
  originX: number;
  originY: number;
}

export interface Renderer {
  readonly kind: 'webgl2' | 'canvas2d';
  readonly canvas: HTMLCanvasElement;
  lost: boolean;
  setAtlas(atlas: Atlas): void;
  resize(layout: Layout): void;
  /** Upload a newly composed tick. The previous upload becomes the interpolation source. */
  upload(frame: StyledFrame): void;
  draw(u: FrameUniforms): void;
  dispose(): void;
}
