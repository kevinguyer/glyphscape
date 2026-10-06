import type { Grid } from './grid';
import { hash2 } from './rng';
import { smoothstep } from './math';

// 5x7 bitmap digits.
const FONT: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  ':': ['00000', '00100', '00100', '00000', '00100', '00100', '00000'],
};

const DURATION = 16;

/**
 * Once an hour the time condenses out of the scene's own light, holds, then falls apart.
 * Works on any scene because it only raises brightness in the grid before styling.
 */
export class GhostClock {
  private start = -1;
  private text = '';
  private lastHour = -1;

  /** Call each tick with wall-clock time. Returns true while active. */
  check(now: Date, enabled: boolean, elapsed: number) {
    const h = now.getHours();
    if (enabled && now.getMinutes() === 0 && h !== this.lastHour && this.start < 0) {
      this.trigger(now, elapsed);
    }
    if (now.getMinutes() !== 0) this.lastHour = -1;
    if (this.start >= 0 && elapsed - this.start > DURATION) this.start = -1;
    return this.start >= 0;
  }

  trigger(now: Date, elapsed: number) {
    this.lastHour = now.getHours();
    this.start = elapsed;
    this.text = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  get active() {
    return this.start >= 0;
  }

  apply(grid: Grid, elapsed: number, aspect: number) {
    if (this.start < 0) return;
    const p = elapsed - this.start;
    const { cols, rows } = grid;
    const chars = this.text.split('');
    // Size: digits about 28% of screen height, constrained by width.
    const glyphCols = chars.length * 6 - 1;
    let unit = Math.floor((rows * 0.28) / 7); // cells per bitmap pixel vertically
    let unitX = Math.max(1, Math.round(unit / aspect / 1.0));
    while (unitX * glyphCols > cols * 0.8 && unit > 1) {
      unit--;
      unitX = Math.max(1, Math.round(unit / aspect));
    }
    unit = Math.max(1, unit);
    const w = glyphCols * unitX, h = 7 * unit;
    const ox = Math.floor((cols - w) / 2), oy = Math.floor((rows - h) / 2);

    const condense = smoothstep(0, 4, p);
    const fall = p > 9 ? (p - 9) / (DURATION - 9) : 0;
    const fade = 1 - smoothstep(0.35, 1, fall);
    const V = grid.v, C = grid.col, G = grid.glyph;

    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const rnd = hash2(x, y, 977);
        // While falling apart, each cell samples from a little higher up, so the digits rain down.
        const drop = fall > 0 ? fall * fall * (0.3 + rnd) * rows * 0.35 : 0;
        const sy = y - drop;
        const bx = Math.floor((x - ox) / unitX);
        const by = Math.floor((sy - oy) / unit);
        if (bx < 0 || by < 0 || by >= 7 || bx >= glyphCols) continue;
        const ci = Math.floor(bx / 6);
        const px = bx % 6;
        if (px === 5) continue;
        const bits = FONT[chars[ci]];
        if (!bits || bits[by][px] !== '1') continue;
        if (rnd > condense) continue;
        if (fall > 0 && hash2(x, y, 31) < fall * 0.8) continue;
        const twinkle = 0.85 + 0.15 * Math.sin(p * 2.1 + rnd * 20);
        const amt = 0.82 * twinkle * fade;
        const i = y * cols + x;
        if (amt > V[i]) {
          V[i] = amt;
          G[i] = 0;
          const c = i * 3;
          C[c] = C[c] * 0.6 + 0.4; C[c + 1] = C[c + 1] * 0.6 + 0.4; C[c + 2] = C[c + 2] * 0.6 + 0.4;
        }
      }
    }
  }
}
