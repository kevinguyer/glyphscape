import type { Atlas } from './glyphs';
import { GLYPH_SETS } from './glyphs';
import type { Grid } from './grid';
import { createNoise } from './noise';
import { hash2 } from './rng';
import type { ResolvedStyle } from './styles';

/** A styled frame: what the renderer uploads. One atlas glyph + fg/bg color per cell. */
export class StyledFrame {
  n: number;
  glyph: Uint16Array;
  fg: Uint8ClampedArray;
  bg: Uint8ClampedArray;
  constructor(public cols: number, public rows: number) {
    this.n = cols * rows;
    this.glyph = new Uint16Array(this.n);
    this.fg = new Uint8ClampedArray(this.n * 4);
    this.bg = new Uint8ClampedArray(this.n * 4);
  }
}

export type TransitionType = 'crossfade' | 'dissolve' | 'wipe';

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
// Braille dot thresholds (4 rows x 2 cols), ordered so dots fill in an even pattern.
const BRAILLE_T = [
  [0, 4],
  [6, 2],
  [1, 5],
  [7, 3],
].map((r) => r.map((v) => 0.1 + ((v + 0.5) / 8) * 0.86)); // floor keeps dim haze from becoming a dot grid
// Bit for dot at (col, row) per the Unicode braille layout.
const BRAILLE_BIT = [
  [0, 3],
  [1, 4],
  [2, 5],
  [6, 7],
];

export class Compositor {
  private atlas!: Atlas;
  private ramps = new Map<string, Uint16Array>();
  private brailleBase = 0;
  private spaceIdx = 0;
  private curveKey = '';
  private curve = new Float32Array(1025);
  cols = 0;
  rows = 0;
  /** Static per-cell noise in 0..1 used for dissolve masks. */
  mask = new Float32Array(0);

  setAtlas(atlas: Atlas) {
    this.atlas = atlas;
    this.ramps.clear();
    for (const [id, set] of Object.entries(GLYPH_SETS)) this.ramps.set(id, atlas.ramp(set.ramp));
    this.brailleBase = atlas.index(0x2800);
    this.spaceIdx = atlas.index(32);
  }

  resize(cols: number, rows: number) {
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    this.mask = new Float32Array(cols * rows);
    const noise = createNoise(7);
    let lo = Infinity, hi = -Infinity;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const v = noise.fbm2(x * 0.045, y * 0.075, 3) + (hash2(x, y, 3) - 0.5) * 0.18;
        this.mask[y * cols + x] = v;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    for (let i = 0; i < this.mask.length; i++) this.mask[i] = (this.mask[i] - lo) / (hi - lo || 1);
  }

  private contrastCurve(c: number, bp: number) {
    const key = `${c.toFixed(4)}|${bp}`;
    if (key === this.curveKey) return this.curve;
    this.curveKey = key;
    for (let i = 0; i <= 1024; i++) {
      const v = Math.max(0, (i / 1024 - bp) / (1 - bp));
      const a = Math.pow(v, c);
      const b = Math.pow(1 - v, c);
      this.curve[i] = a / (a + b || 1);
    }
    return this.curve;
  }

  /** Map a scene's brightness/color field through a style into glyphs and colors. */
  style(grid: Grid, st: ResolvedStyle, out: StyledFrame, useHints: boolean) {
    const { cols, rows } = grid;
    const n = Math.min(grid.n, out.n);
    const curve = this.contrastCurve(st.contrast, st.blackPoint);
    const set = st.glyphSet;
    const ramp = this.ramps.get(set)!;
    const rl = ramp.length - 1;
    const hintsOk = useHints && (set === 'classic' || set === 'dense');
    const atlas = this.atlas;
    const V = grid.v, C = grid.col, G = grid.glyph;
    const lut = st.lut;
    const fr = st.fg[0] * 255, fgG = st.fg[1] * 255, fb = st.fg[2] * 255;
    const br = st.bg[0] * 255, bgG = st.bg[1] * 255, bb = st.bg[2] * 255;
    const minA = st.minAlpha;
    const mode = st.colorMode;
    const dither = st.dither;
    const nativeGain = st.light ? 0.55 : 1;
    const usesBg = grid.usesBg;
    const BG = grid.bg;
    const OG = out.glyph, OF = out.fg, OB = out.bg;

    for (let i = 0; i < n; i++) {
      const x = i % cols;
      const y = (i / cols) | 0;
      let v = V[i];
      v = v <= 0 ? 0 : v >= 1 ? 1 : v;
      v = curve[(v * 1024) | 0];

      // Glyph
      let gi: number;
      const hint = G[i];
      if (hintsOk && hint) {
        gi = hint === 32 ? this.spaceIdx : atlas.index(hint);
      } else if (set === 'braille') {
        gi = this.brailleBase + brailleBits(V, cols, rows, x, y, curve, dither === 'blue' ? hash2(x, y, 11) - 0.5 : 0);
      } else {
        let d = 0.5;
        if (v < 0.15) {
          // Faint haze: scattered blue-noise specks rather than a uniform grid of dots.
          // (Applies to every style, since a regular grid of '.' reads as a texture, not light.)
          d = v > 0.02 ? hash2(x, y, 5) : 0;
        } else if (dither !== 'none') {
          d = dither === 'ordered' ? BAYER4[(y & 3) * 4 + (x & 3)] : ign(x, y);
        }
        let lvl = (v * rl + d) | 0;
        if (lvl > rl) lvl = rl;
        if (v <= 0.002) lvl = 0;
        gi = ramp[lvl];
      }
      OG[i] = gi;

      // Foreground color
      const o = i * 4;
      let r: number, g: number, b: number;
      if (mode === 'mono') {
        r = fr; g = fgG; b = fb;
      } else if (mode === 'native') {
        const c = i * 3;
        r = C[c] * 255 * nativeGain; g = C[c + 1] * 255 * nativeGain; b = C[c + 2] * 255 * nativeGain;
      } else {
        const l = ((v * 255) | 0) * 3;
        r = lut[l] * 255; g = lut[l + 1] * 255; b = lut[l + 2] * 255;
      }
      OF[o] = r; OF[o + 1] = g; OF[o + 2] = b;
      let a = minA + (1 - minA) * v;
      if (hintsOk && hint) a = Math.max(a, 0.35 + 0.65 * v);
      OF[o + 3] = a * 255;

      // Background
      if (usesBg && BG[o + 3] > 0) {
        const ba = BG[o + 3];
        OB[o] = br + (BG[o] * 255 - br) * ba;
        OB[o + 1] = bgG + (BG[o + 1] * 255 - bgG) * ba;
        OB[o + 2] = bb + (BG[o + 2] * 255 - bb) * ba;
      } else {
        OB[o] = br; OB[o + 1] = bgG; OB[o + 2] = bb;
      }
      OB[o + 3] = 255;
    }
  }

  /** Blend two styled frames for a scene transition. t is eased progress 0..1. */
  blend(a: StyledFrame, b: StyledFrame, t: number, type: TransitionType, out: StyledFrame) {
    const n = Math.min(a.n, b.n, out.n);
    const cols = this.cols;
    const M = this.mask;
    const band = 0.14;
    for (let i = 0; i < n; i++) {
      let m: number;
      let thr = 0.5;
      if (type === 'crossfade') {
        m = t;
        thr = 0.3 + 0.4 * M[i];
      } else {
        const k = type === 'wipe' ? (i % cols) / cols * 0.8 + M[i] * 0.2 : M[i];
        const e = t * (1 + 2 * band) - band;
        m = e <= k - band ? 0 : e >= k + band ? 1 : (e - (k - band)) / (2 * band);
      }
      const o = i * 4;
      const useB = m >= thr;
      const src = useB ? b : a;
      out.glyph[i] = src.glyph[i];
      // Fade the outgoing glyph down, then the incoming glyph up.
      const w = useB ? (m - thr) / (1 - thr) : 1 - m / thr;
      let alpha = src.fg[o + 3] * (type === 'crossfade' ? w : 0.25 + 0.75 * w);
      let boost = 0;
      if (type !== 'crossfade' && m > 0 && m < 1) boost = 1 - Math.abs(m - 0.5) * 2; // glinting edge
      alpha = Math.min(255, alpha + boost * 90);
      out.fg[o] = Math.min(255, src.fg[o] + boost * 40);
      out.fg[o + 1] = Math.min(255, src.fg[o + 1] + boost * 40);
      out.fg[o + 2] = Math.min(255, src.fg[o + 2] + boost * 40);
      out.fg[o + 3] = alpha;
      out.bg[o] = a.bg[o] + (b.bg[o] - a.bg[o]) * m;
      out.bg[o + 1] = a.bg[o + 1] + (b.bg[o + 1] - a.bg[o + 1]) * m;
      out.bg[o + 2] = a.bg[o + 2] + (b.bg[o + 2] - a.bg[o + 2]) * m;
      out.bg[o + 3] = 255;
    }
  }

  /** Plain text of a styled frame (for photo mode). */
  toText(f: StyledFrame): string {
    const lines: string[] = [];
    for (let y = 0; y < f.rows; y++) {
      let s = '';
      for (let x = 0; x < f.cols; x++) s += String.fromCodePoint(this.atlas.codepoints[f.glyph[y * f.cols + x]] ?? 32);
      lines.push(s.replace(/\s+$/, ''));
    }
    return lines.join('\n');
  }
}

/** Interleaved gradient noise: a cheap blue-noise-like threshold. */
function ign(x: number, y: number) {
  const f = 0.06711056 * x + 0.00583715 * y;
  const g = 52.9829189 * (f - Math.floor(f));
  return g - Math.floor(g);
}

// Vertical weights of rows (y-1, y, y+1) for the four dot rows of a braille cell.
const BRAILLE_VW = [
  [0.375, 0.625, 0],
  [0.125, 0.875, 0],
  [0, 0.875, 0.125],
  [0, 0.625, 0.375],
];
const bl = new Float32Array(3), br = new Float32Array(3);

/** 2x4 sub-cell dots: each dot is a fixed-weight bilinear blend of the 3x3 neighborhood. */
function brailleBits(V: Float32Array, cols: number, rows: number, x: number, y: number, curve: Float32Array, jitter: number) {
  const xm = x > 0 ? x - 1 : x, xp = x < cols - 1 ? x + 1 : x;
  for (let k = 0; k < 3; k++) {
    let yy = y + k - 1;
    if (yy < 0) yy = 0;
    if (yy >= rows) yy = rows - 1;
    const o = yy * cols;
    const c = V[o + x];
    bl[k] = 0.25 * V[o + xm] + 0.75 * c;
    br[k] = 0.75 * c + 0.25 * V[o + xp];
  }
  let bits = 0;
  const j = jitter * 0.12;
  for (let r = 0; r < 4; r++) {
    const w = BRAILLE_VW[r];
    let a = w[0] * bl[0] + w[1] * bl[1] + w[2] * bl[2];
    let b = w[0] * br[0] + w[1] * br[1] + w[2] * br[2];
    a = a <= 0 ? 0 : a >= 1 ? 1 : a;
    b = b <= 0 ? 0 : b >= 1 ? 1 : b;
    if (curve[(a * 1024) | 0] > BRAILLE_T[r][0] + j) bits |= 1 << BRAILLE_BIT[r][0];
    if (curve[(b * 1024) | 0] > BRAILLE_T[r][1] + j) bits |= 1 << BRAILLE_BIT[r][1];
  }
  return bits;
}
