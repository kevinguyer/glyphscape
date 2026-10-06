import type { GlyphSetId } from './glyphs';
import { hexToRgb, lerp, sampleGradient, type RGB } from './math';
import type { ColorMode } from './types';

export interface PostFx {
  glow: number;
  persistence: number;
  scanlines: number;
  curvature: number;
  chroma: number;
  grain: number;
  vignette: number;
}

export type DitherMode = 'none' | 'ordered' | 'blue';

export interface Palette {
  bg: string;
  fg: string;
  duo: [string, string];
  stops: string[];
}

export interface StyleDef {
  id: string;
  name: string;
  blurb: string;
  glyphSet: GlyphSetId;
  colorMode: ColorMode;
  palette: Palette;
  dither: DitherMode;
  post: PostFx;
  /** Glyph opacity at zero brightness; brightness is carried mostly by glyph shape. */
  minAlpha: number;
  /** Brightness below this maps to blank (keeps faint haze from cluttering dense ramps). */
  blackPoint?: number;
}

const NO_FX: PostFx = { glow: 0, persistence: 0, scanlines: 0, curvature: 0, chroma: 0, grain: 0, vignette: 0 };
const fx = (p: Partial<PostFx>): PostFx => ({ ...NO_FX, ...p });

export const STYLES: StyleDef[] = [
  {
    id: 'clean-mono', name: 'Clean Mono', blurb: 'White on black, no effects',
    glyphSet: 'classic', colorMode: 'mono', dither: 'blue', minAlpha: 0.55,
    palette: { bg: '#000000', fg: '#e9e9e9', duo: ['#3a3a3a', '#ffffff'], stops: ['#1a1a1a', '#8a8a8a', '#ffffff'] },
    post: NO_FX,
  },
  {
    id: 'green-phosphor', name: 'Green Phosphor', blurb: 'P1 phosphor glow and persistence',
    glyphSet: 'classic', colorMode: 'mono', dither: 'ordered', minAlpha: 0.45,
    palette: { bg: '#010802', fg: '#41ff6e', duo: ['#0b4a1c', '#b8ffc9'], stops: ['#06260f', '#1fae45', '#41ff6e', '#d4ffe0'] },
    post: fx({ glow: 0.55, persistence: 0.55, vignette: 0.35, scanlines: 0.12 }),
  },
  {
    id: 'amber-crt', name: 'Amber CRT', blurb: 'Amber terminal, scanlines, curved glass',
    glyphSet: 'classic', colorMode: 'mono', dither: 'ordered', minAlpha: 0.45,
    palette: { bg: '#0a0400', fg: '#ffb000', duo: ['#4a2200', '#ffd88a'], stops: ['#2a1200', '#c46a00', '#ffb000', '#ffe6b0'] },
    post: fx({ glow: 0.5, persistence: 0.3, scanlines: 0.5, curvature: 0.4, vignette: 0.55 }),
  },
  {
    id: 'paper-ink', name: 'Paper Ink', blurb: 'Dense ink on warm paper',
    glyphSet: 'dense', colorMode: 'mono', dither: 'blue', minAlpha: 0.6, blackPoint: 0.12,
    palette: { bg: '#f1eadb', fg: '#1d1a24', duo: ['#8a7f73', '#14121a'], stops: ['#b3a898', '#5a4e48', '#14121a'] },
    post: fx({ grain: 0.35, vignette: 0.18 }),
  },
  {
    id: 'braille-fine', name: 'Braille Fine', blurb: 'Sub-cell braille dots, ice blue',
    glyphSet: 'braille', colorMode: 'mono', dither: 'ordered', minAlpha: 0.55,
    palette: { bg: '#01040a', fg: '#a6dcff', duo: ['#1c4a7a', '#e6f6ff'], stops: ['#0c2440', '#3d8fd6', '#a6dcff', '#ffffff'] },
    post: fx({ glow: 0.35, vignette: 0.25 }),
  },
  {
    id: 'blocks', name: 'Blocks', blurb: 'Shaded blocks in the scene\'s own colors',
    glyphSet: 'blocks', colorMode: 'native', dither: 'ordered', minAlpha: 0.85,
    palette: { bg: '#000000', fg: '#f0f0f0', duo: ['#203050', '#f0e0a0'], stops: ['#101830', '#305090', '#f0a040', '#fff0c0'] },
    post: NO_FX,
  },
  {
    id: 'vapor', name: 'Vapor', blurb: 'Magenta to cyan with chromatic fringe',
    glyphSet: 'classic', colorMode: 'gradient', dither: 'ordered', minAlpha: 0.5,
    palette: { bg: '#07010d', fg: '#ff4fd8', duo: ['#ff2bd6', '#00e5ff'], stops: ['#2a0040', '#ff2bd6', '#8a5cff', '#00e5ff', '#d8fbff'] },
    post: fx({ glow: 0.6, chroma: 0.5, vignette: 0.35, scanlines: 0.1 }),
  },
  {
    id: 'borealis', name: 'Borealis', blurb: 'Green to violet aurora gradient',
    glyphSet: 'classic', colorMode: 'gradient', dither: 'ordered', minAlpha: 0.5,
    palette: { bg: '#010309', fg: '#5dffa8', duo: ['#5a2a9a', '#5dffa8'], stops: ['#1a0f3a', '#5a2a9a', '#9a4fd0', '#1fb58f', '#5dffa8', '#e2fff0'] },
    post: fx({ glow: 0.5, persistence: 0.25, vignette: 0.3 }),
  },
  {
    id: 'firelight', name: 'Firelight', blurb: 'Native warm colors with soft glow',
    glyphSet: 'classic', colorMode: 'native', dither: 'ordered', minAlpha: 0.5,
    palette: { bg: '#060201', fg: '#ffb36b', duo: ['#6a1a05', '#ffd27a'], stops: ['#2a0500', '#a32a06', '#ff7a1a', '#ffd27a', '#fff6e0'] },
    post: fx({ glow: 0.6, persistence: 0.2, vignette: 0.45 }),
  },
  {
    id: 'midnight', name: 'Midnight', blurb: 'Native colors on deep navy, lingering trails',
    glyphSet: 'classic', colorMode: 'native', dither: 'ordered', minAlpha: 0.5,
    palette: { bg: '#02040c', fg: '#cfe0ff', duo: ['#1b2a55', '#e6f0ff'], stops: ['#060c24', '#1d3570', '#5b7fc4', '#cfe0ff', '#ffffff'] },
    post: fx({ glow: 0.45, persistence: 0.35, vignette: 0.35 }),
  },
];

export const styleById = (id: string) => STYLES.find((s) => s.id === id) ?? STYLES[0];

export const COLOR_MODES: { id: ColorMode; name: string }[] = [
  { id: 'mono', name: 'Monochrome' },
  { id: 'duotone', name: 'Duotone' },
  { id: 'gradient', name: 'Gradient' },
  { id: 'native', name: 'Scene Native' },
];

export interface StyleOverrides {
  colorMode: ColorMode | 'style';
  glyphSet: GlyphSetId | 'style';
  dither: DitherMode | 'style';
  palette: Partial<Palette> | null;
  /** Multiplier on the style's post effects. */
  effects: number;
  contrast: number;
}

/** A fully resolved style, ready for the compositor: colors as RGB and a 256-entry LUT. */
export interface ResolvedStyle {
  id: string;
  name: string;
  glyphSet: GlyphSetId;
  colorMode: ColorMode;
  dither: DitherMode;
  bg: RGB;
  fg: RGB;
  lut: Float32Array;
  post: PostFx;
  minAlpha: number;
  contrast: number;
  blackPoint: number;
  light: boolean;
}

export function resolveStyle(def: StyleDef, o: StyleOverrides, forcedColorMode?: ColorMode): ResolvedStyle {
  const pal: Palette = { ...def.palette, ...(o.palette ?? {}) } as Palette;
  const colorMode = o.colorMode !== 'style' ? o.colorMode : forcedColorMode ?? def.colorMode;
  const bg = hexToRgb(pal.bg);
  const fg = hexToRgb(pal.fg);
  const lut = new Float32Array(256 * 3);
  const tmp: RGB = [0, 0, 0];
  const stops = colorMode === 'duotone' ? [hexToRgb(pal.duo[0]), hexToRgb(pal.duo[1])] : pal.stops.map(hexToRgb);
  for (let i = 0; i < 256; i++) {
    sampleGradient(stops, i / 255, tmp);
    lut[i * 3] = tmp[0]; lut[i * 3 + 1] = tmp[1]; lut[i * 3 + 2] = tmp[2];
  }
  const k = o.effects;
  const post: PostFx = {
    glow: def.post.glow * k,
    persistence: Math.min(0.92, def.post.persistence * k),
    scanlines: def.post.scanlines * k,
    curvature: def.post.curvature * k,
    chroma: def.post.chroma * k,
    grain: def.post.grain * k,
    vignette: def.post.vignette * Math.min(1, k),
  };
  const lum = 0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2];
  return {
    id: def.id,
    name: def.name,
    glyphSet: o.glyphSet !== 'style' ? o.glyphSet : def.glyphSet,
    colorMode,
    dither: o.dither !== 'style' ? o.dither : def.dither,
    bg, fg, lut, post,
    minAlpha: def.minAlpha,
    contrast: o.contrast,
    blackPoint: def.blackPoint ?? 0,
    light: lum > 0.5,
  };
}

export function lerpPost(a: PostFx, b: PostFx, t: number): PostFx {
  return {
    glow: lerp(a.glow, b.glow, t),
    persistence: lerp(a.persistence, b.persistence, t),
    scanlines: lerp(a.scanlines, b.scanlines, t),
    curvature: lerp(a.curvature, b.curvature, t),
    chroma: lerp(a.chroma, b.chroma, t),
    grain: lerp(a.grain, b.grain, t),
    vignette: lerp(a.vignette, b.vignette, t),
  };
}
