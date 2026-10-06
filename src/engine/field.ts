/**
 * A low-resolution scalar field that is recomputed every few ticks and sampled bilinearly.
 * Slow-moving backgrounds (nebulae, glows, fog) don't need per-cell, per-tick noise.
 */
export class LowResField {
  w = 0;
  h = 0;
  data = new Float32Array(0);
  private age = Infinity;

  constructor(private factor: number, private every: number) {}

  /** Recompute if stale. fn receives coordinates in full-grid cell units. */
  update(cols: number, rows: number, fn: (x: number, y: number) => number, force = false) {
    const w = Math.ceil(cols / this.factor) + 1;
    const h = Math.ceil(rows / this.factor) + 1;
    if (w !== this.w || h !== this.h) {
      this.w = w;
      this.h = h;
      this.data = new Float32Array(w * h);
      this.age = Infinity;
    }
    if (!force && ++this.age < this.every) return;
    this.age = 0;
    const f = this.factor;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) this.data[y * w + x] = fn(x * f, y * f);
  }

  sample(x: number, y: number): number {
    const fx = x / this.factor, fy = y / this.factor;
    let x0 = fx | 0, y0 = fy | 0;
    const tx = fx - x0, ty = fy - y0;
    if (x0 >= this.w - 1) x0 = this.w - 2;
    if (y0 >= this.h - 1) y0 = this.h - 2;
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    const d = this.data, w = this.w;
    const a = d[y0 * w + x0], b = d[y0 * w + x0 + 1], c = d[(y0 + 1) * w + x0], e = d[(y0 + 1) * w + x0 + 1];
    return (a + (b - a) * tx) * (1 - ty) + (c + (e - c) * tx) * ty;
  }
}

/** Multi-channel variant: one pass computes every channel (e.g. a glow and its color). */
export class LowResFieldN {
  w = 0;
  h = 0;
  data = new Float32Array(0);
  private age = Infinity;

  constructor(private channels: number, private factor: number, private every: number) {}

  update(cols: number, rows: number, fn: (x: number, y: number, out: Float32Array, o: number) => void, force = false) {
    const w = Math.ceil(cols / this.factor) + 1;
    const h = Math.ceil(rows / this.factor) + 1;
    if (w !== this.w || h !== this.h) {
      this.w = w;
      this.h = h;
      this.data = new Float32Array(w * h * this.channels);
      this.age = Infinity;
    }
    if (!force && ++this.age < this.every) return;
    this.age = 0;
    const f = this.factor, c = this.channels;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) fn(x * f, y * f, this.data, (y * w + x) * c);
  }

  /** Bilinear sample of all channels into out. */
  sample(x: number, y: number, out: Float32Array) {
    const fx = x / this.factor, fy = y / this.factor;
    let x0 = fx | 0, y0 = fy | 0;
    const tx = fx - x0, ty = fy - y0;
    if (x0 >= this.w - 1) x0 = this.w - 2;
    if (y0 >= this.h - 1) y0 = this.h - 2;
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    const d = this.data, c = this.channels, w = this.w;
    const a = (y0 * w + x0) * c, b = a + c, e = a + w * c, g = e + c;
    for (let k = 0; k < c; k++) {
      out[k] = (d[a + k] + (d[b + k] - d[a + k]) * tx) * (1 - ty) + (d[e + k] + (d[g + k] - d[e + k]) * tx) * ty;
    }
    return out;
  }
}
