/**
 * The buffer a scene writes into. Scenes never touch the canvas: they describe each cell's
 * brightness, color, and (optionally) a glyph hint, and the engine styles and draws it.
 */
export class Grid {
  cols: number;
  rows: number;
  n: number;
  /** Brightness 0..1 per cell. */
  v: Float32Array;
  /** Scene-native color, rgb 0..1 per cell (used by the Scene Native color mode). */
  col: Float32Array;
  /** Glyph hint as a Unicode code point; 0 means "let the style's ramp decide". */
  glyph: Uint32Array;
  /** Optional per-cell background, rgba 0..1. Alpha 0 means the style background shows. */
  bg: Float32Array;
  usesBg = false;

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.n = cols * rows;
    this.v = new Float32Array(this.n);
    this.col = new Float32Array(this.n * 3);
    this.glyph = new Uint32Array(this.n);
    this.bg = new Float32Array(this.n * 4);
  }

  clear(v = 0, r = 1, g = 1, b = 1) {
    this.v.fill(v);
    const c = this.col;
    for (let i = 0; i < c.length; i += 3) {
      c[i] = r; c[i + 1] = g; c[i + 2] = b;
    }
    this.glyph.fill(0);
    if (this.usesBg) this.bg.fill(0);
    this.usesBg = false;
  }

  inside(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }

  /** Overwrite a cell. */
  set(x: number, y: number, v: number, r = 1, g = 1, b = 1, glyph = 0) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    const i = y * this.cols + x;
    this.v[i] = v;
    const c = i * 3;
    this.col[c] = r; this.col[c + 1] = g; this.col[c + 2] = b;
    this.glyph[i] = glyph;
  }

  /** Brighten a cell, keeping the brighter of the two and blending color by contribution. */
  max(x: number, y: number, v: number, r = 1, g = 1, b = 1, glyph = 0) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    const i = y * this.cols + x;
    if (v > this.v[i]) {
      this.v[i] = v;
      const c = i * 3;
      this.col[c] = r; this.col[c + 1] = g; this.col[c + 2] = b;
      if (glyph) this.glyph[i] = glyph;
    }
  }

  /** Additive light: adds brightness and mixes color weighted by the added amount. */
  add(x: number, y: number, v: number, r = 1, g = 1, b = 1) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows || v <= 0) return;
    const i = y * this.cols + x;
    const old = this.v[i];
    const nv = old + v;
    const w = v / (nv || 1);
    const c = i * 3;
    this.col[c] += (r - this.col[c]) * w;
    this.col[c + 1] += (g - this.col[c + 1]) * w;
    this.col[c + 2] += (b - this.col[c + 2]) * w;
    this.v[i] = nv > 1 ? 1 : nv;
  }

  /** Additive splat with bilinear weights, for smooth sub-cell motion. */
  splat(x: number, y: number, v: number, r = 1, g = 1, b = 1) {
    const x0 = Math.floor(x - 0.5), y0 = Math.floor(y - 0.5);
    const fx = x - 0.5 - x0, fy = y - 0.5 - y0;
    this.add(x0, y0, v * (1 - fx) * (1 - fy), r, g, b);
    this.add(x0 + 1, y0, v * fx * (1 - fy), r, g, b);
    this.add(x0, y0 + 1, v * (1 - fx) * fy, r, g, b);
    this.add(x0 + 1, y0 + 1, v * fx * fy, r, g, b);
  }

  setBg(x: number, y: number, r: number, g: number, b: number, a = 1) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return;
    const i = (y * this.cols + x) * 4;
    this.bg[i] = r; this.bg[i + 1] = g; this.bg[i + 2] = b; this.bg[i + 3] = a;
    this.usesBg = true;
  }

  /** Write a string of glyph hints starting at (x, y). Spaces are skipped unless `solid`. */
  text(x: number, y: number, s: string, v: number, r = 1, g = 1, b = 1, solid = false) {
    let cx = x | 0;
    for (const ch of s) {
      if (ch !== ' ' || solid) this.set(cx, y, ch === ' ' ? 0 : v, r, g, b, ch.codePointAt(0)!);
      cx++;
    }
  }

  copyFrom(o: Grid) {
    this.v.set(o.v);
    this.col.set(o.col);
    this.glyph.set(o.glyph);
    this.bg.set(o.bg);
    this.usesBg = o.usesBg;
  }
}
