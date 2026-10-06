import { FONT_FAMILY } from './glyphs';
import type { Grid } from './grid';

/**
 * Hand-authored animation format: an array of text frames with per-frame timing, an optional
 * static base layer drawn beneath them, and optional per-cell color layers whose characters
 * are keys into a palette. Spaces are transparent.
 */
export interface AuthoredFrame {
  rows: string[];
  ms: number;
  colors?: string[];
}

export interface FrameAnim {
  width: number;
  height: number;
  base?: string[];
  baseColors?: string[];
  frames: AuthoredFrame[];
  /** Position of the frame layer within the base. */
  frameX?: number;
  frameY?: number;
  palette?: Record<string, [number, number, number]>;
}

export class FramePlayer {
  index = 0;
  private elapsed = 0;
  constructor(public anim: FrameAnim, public speed = 1) {}

  update(dt: number) {
    const frames = this.anim.frames;
    this.elapsed += dt * 1000 * this.speed;
    while (this.elapsed >= frames[this.index].ms) {
      this.elapsed -= frames[this.index].ms;
      this.index = (this.index + 1) % frames.length;
    }
  }

  get frame() {
    return this.anim.frames[this.index];
  }
}

// --- Glyph coverage bitmaps, used to "re-rasterize" authored characters at large scales ---

const BW = 12, BH = 20;
const bitmapCache = new Map<string, Float32Array>();
let scratch: CanvasRenderingContext2D | null = null;

export function charBitmap(ch: string): Float32Array {
  let bm = bitmapCache.get(ch);
  if (bm) return bm;
  bm = new Float32Array(BW * BH);
  if (ch !== ' ' && typeof document !== 'undefined') {
    if (!scratch) {
      const c = document.createElement('canvas');
      c.width = BW;
      c.height = BH;
      scratch = c.getContext('2d', { willReadFrequently: true })!;
    }
    const s = scratch;
    s.clearRect(0, 0, BW, BH);
    s.fillStyle = '#fff';
    s.font = `${BH * 0.8}px ${FONT_FAMILY}`;
    s.textAlign = 'center';
    s.textBaseline = 'middle';
    s.fillText(ch, BW / 2, BH * 0.52);
    const d = s.getImageData(0, 0, BW, BH).data;
    for (let i = 0; i < BW * BH; i++) bm[i] = d[i * 4 + 3] / 255;
  }
  bitmapCache.set(ch, bm);
  return bm;
}

const densityCache = new Map<string, number>();
/** Fraction of a cell an authored character covers, normalized so '@' is about 1. */
export function charDensity(ch: string): number {
  let d = densityCache.get(ch);
  if (d !== undefined) return d;
  const bm = charBitmap(ch);
  let s = 0;
  for (let i = 0; i < bm.length; i++) s += bm[i];
  const ref = charBitmapSum('@');
  d = ref > 0 ? Math.min(1, s / ref) : 0.5;
  densityCache.set(ch, d);
  return d;
}

let refSum = -1;
function charBitmapSum(ch: string) {
  if (refSum >= 0) return refSum;
  const bm = charBitmap(ch);
  refSum = 0;
  for (let i = 0; i < bm.length; i++) refSum += bm[i];
  return refSum;
}

/** Sample the coverage of an authored char over a sub-rectangle (fractions 0..1). */
function coverage(ch: string, u0: number, v0: number, u1: number, v1: number) {
  const bm = charBitmap(ch);
  const x0 = Math.floor(u0 * BW), x1 = Math.max(x0 + 1, Math.ceil(u1 * BW));
  const y0 = Math.floor(v0 * BH), y1 = Math.max(y0 + 1, Math.ceil(v1 * BH));
  let s = 0, c = 0, m = 0;
  for (let y = y0; y < y1 && y < BH; y++) {
    for (let x = x0; x < x1 && x < BW; x++) {
      const v = bm[y * BW + x];
      s += v;
      c++;
      if (v > m) m = v;
    }
  }
  // Blend of average and peak, so thin strokes stay visible when a glyph is enlarged.
  return c ? 0.4 * (s / c) + 0.6 * m : 0;
}

export interface Placement {
  /** Grid cells per authored character. */
  scale: number;
  ox: number;
  oy: number;
  native: boolean;
}

/** Fit authored art (w x h chars) into the grid, centered, with a margin. */
export function placeArt(cols: number, rows: number, w: number, h: number, fill = 0.94): Placement {
  const s = Math.min(cols / w, rows / h) * fill;
  let scale: number;
  if (s >= 2) scale = Math.floor(s);
  else if (s >= 1) scale = 1;
  else scale = s;
  const native = scale === 1;
  const ox = Math.floor((cols - w * scale) / 2);
  const oy = Math.floor((rows - h * scale) / 2);
  return { scale, ox, oy, native };
}

export type CellPainter = (gx: number, gy: number, ch: string, ax: number, ay: number, v: number) => void;

/**
 * Draw a layer of authored text into the grid using a placement:
 * - native scale: exact glyphs (as hints) with brightness from char density
 * - integer upscale: each char is re-rasterized into a k x k block of cells
 * - downscale: area-averaged density
 * The painter decides final brightness and color for each touched cell.
 */
export function drawLayer(
  grid: Grid,
  rowsText: string[],
  pl: Placement,
  atX: number,
  atY: number,
  paint: CellPainter,
) {
  const { scale, ox, oy } = pl;
  const h = rowsText.length;
  if (pl.native) {
    for (let y = 0; y < h; y++) {
      const line = rowsText[y];
      for (let x = 0; x < line.length; x++) {
        const ch = line[x];
        if (ch === ' ') continue;
        paint(ox + atX + x, oy + atY + y, ch, atX + x, atY + y, charDensity(ch));
      }
    }
    return;
  }
  if (scale > 1) {
    const k = scale;
    for (let y = 0; y < h; y++) {
      const line = rowsText[y];
      for (let x = 0; x < line.length; x++) {
        const ch = line[x];
        if (ch === ' ') continue;
        const gx0 = ox + (atX + x) * k, gy0 = oy + (atY + y) * k;
        for (let sy = 0; sy < k; sy++) {
          for (let sx = 0; sx < k; sx++) {
            const c = coverage(ch, sx / k, sy / k, (sx + 1) / k, (sy + 1) / k);
            if (c < 0.12) continue;
            paint(gx0 + sx, gy0 + sy, ch, atX + x + (sx + 0.5) / k, atY + y + (sy + 0.5) / k, Math.min(1, c * 1.1));
          }
        }
      }
    }
    return;
  }
  // Downscale: each grid cell averages the chars it covers.
  const inv = 1 / scale;
  const gw = Math.ceil(rowsText.reduce((m, l) => Math.max(m, l.length), 0) * scale);
  const gh = Math.ceil(h * scale);
  const ax0 = Math.floor(atX * scale), ay0 = Math.floor(atY * scale);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const sx0 = gx * inv, sy0 = gy * inv;
      let sum = 0, cnt = 0;
      let rep = ' ';
      for (let yy = Math.floor(sy0); yy < Math.min(h, Math.ceil(sy0 + inv)); yy++) {
        const line = rowsText[yy];
        for (let xx = Math.floor(sx0); xx < Math.min(line.length, Math.ceil(sx0 + inv)); xx++) {
          const ch = line[xx];
          cnt++;
          if (ch === ' ') continue;
          sum += charDensity(ch);
          rep = ch;
        }
      }
      if (rep === ' ' || !cnt) continue;
      paint(ox + ax0 + gx, oy + ay0 + gy, rep, atX + sx0 + inv / 2, atY + sy0 + inv / 2, Math.min(1, (sum / cnt) * 1.4));
    }
  }
}
