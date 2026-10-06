/**
 * Glyph sets and the glyph atlas. Every glyph is rasterized once per cell size into a single
 * texture. Braille, block elements, box drawing and a few shapes are drawn procedurally so they
 * look identical on every machine and tile seamlessly; text glyphs use the bundled font.
 */

export type GlyphSetId = 'classic' | 'dense' | 'braille' | 'blocks';

export const GLYPH_SETS: Record<GlyphSetId, { name: string; ramp: string }> = {
  classic: { name: 'Classic ramp', ramp: ' .:-=+*#%@' },
  dense: {
    name: 'Dense ramp',
    ramp: " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  },
  braille: { name: 'Braille dots', ramp: ' ⠁⠃⠇⡇⡏⡟⡿⣿' },
  blocks: { name: 'Block elements', ramp: ' ░▒▓█' },
};

export const FONT_FAMILY = '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace';
/** Cell width as a fraction of cell height. Matches JetBrains Mono's advance (0.6em). */
export const CELL_ASPECT = 0.6;

const EXTRA = '·°¨´¸¦«»¬±×÷¤•…‾′″€¡¿';
const SHAPES: Record<number, string> = {
  0x25cf: 'disc', // ●
  0x25cb: 'ring', // ○
  0x25e6: 'smallring', // ◦
  0x2219: 'dot', // ∙
  0x25a0: 'square', // ■
  0x25aa: 'smallsquare', // ▪
  0x2726: 'star', // ✦
};

function buildCodepoints(): number[] {
  const cps: number[] = [];
  for (let c = 32; c <= 126; c++) cps.push(c);
  for (const ch of EXTRA) cps.push(ch.codePointAt(0)!);
  for (let c = 0x2500; c <= 0x2573; c++) if (BOX[c]) cps.push(c);
  for (let c = 0x2580; c <= 0x259f; c++) cps.push(c);
  for (let c = 0x2800; c <= 0x28ff; c++) cps.push(c);
  for (const k of Object.keys(SHAPES)) cps.push(Number(k));
  return cps;
}

// Box drawing: [up, down, left, right]; 1 light, 2 heavy, 3 double. 'r' = rounded corner.
const BOX: Record<number, [number, number, number, number] | 'diagA' | 'diagB' | 'diagX'> = {
  0x2500: [0, 0, 1, 1], 0x2501: [0, 0, 2, 2], 0x2502: [1, 1, 0, 0], 0x2503: [2, 2, 0, 0],
  0x250c: [0, 1, 0, 1], 0x2510: [0, 1, 1, 0], 0x2514: [1, 0, 0, 1], 0x2518: [1, 0, 1, 0],
  0x251c: [1, 1, 0, 1], 0x2524: [1, 1, 1, 0], 0x252c: [0, 1, 1, 1], 0x2534: [1, 0, 1, 1],
  0x253c: [1, 1, 1, 1],
  0x2550: [0, 0, 3, 3], 0x2551: [3, 3, 0, 0], 0x2554: [0, 3, 0, 3], 0x2557: [0, 3, 3, 0],
  0x255a: [3, 0, 0, 3], 0x255d: [3, 0, 3, 0], 0x2560: [3, 3, 0, 3], 0x2563: [3, 3, 3, 0],
  0x2566: [0, 3, 3, 3], 0x2569: [3, 0, 3, 3], 0x256c: [3, 3, 3, 3],
  0x256d: [0, 1, 0, 1], 0x256e: [0, 1, 1, 0], 0x256f: [1, 0, 1, 0], 0x2570: [1, 0, 0, 1],
  0x2571: 'diagA', 0x2572: 'diagB', 0x2573: 'diagX',
};

export interface Atlas {
  canvas: HTMLCanvasElement;
  cellW: number;
  cellH: number;
  /** Glyphs per atlas row. */
  cols: number;
  codepoints: number[];
  /** Atlas index for a code point (falls back to '?'). */
  index(cp: number): number;
  /** Atlas indices for each character of a ramp string. */
  ramp(s: string): Uint16Array;
  version: number;
}

const LOOKUP_SIZE = 0x2900;
let atlasVersion = 0;

export function buildAtlas(cellW: number, cellH: number): Atlas {
  const codepoints = buildCodepoints();
  const cols = Math.max(1, Math.min(64, Math.floor(4096 / cellW)));
  const rows = Math.ceil(codepoints.length / cols);
  const canvas = document.createElement('canvas');
  canvas.width = cols * cellW;
  canvas.height = rows * cellH;
  const ctx = canvas.getContext('2d', { willReadFrequently: false })!;
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';

  // Fit the font to the cell: advance width to cellW, and the font box inside cellH.
  ctx.font = `100px ${FONT_FAMILY}`;
  const adv = ctx.measureText('M').width || 60;
  let size = Math.min((cellW / adv) * 100, cellH * 0.86);
  ctx.font = `${size}px ${FONT_FAMILY}`;
  let m = ctx.measureText('Mg');
  let asc = m.fontBoundingBoxAscent ?? size * 0.8;
  let desc = m.fontBoundingBoxDescent ?? size * 0.2;
  if (asc + desc > cellH) {
    size *= cellH / (asc + desc);
    ctx.font = `${size}px ${FONT_FAMILY}`;
    m = ctx.measureText('Mg');
    asc = m.fontBoundingBoxAscent ?? size * 0.8;
    desc = m.fontBoundingBoxDescent ?? size * 0.2;
  }
  const baseline = Math.round((cellH - (asc + desc)) / 2 + asc);
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'center';

  const lookup = new Int16Array(LOOKUP_SIZE).fill(-1);
  const extra = new Map<number, number>();
  codepoints.forEach((cp, i) => {
    const x = (i % cols) * cellW;
    const y = Math.floor(i / cols) * cellH;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, cellW, cellH);
    ctx.clip();
    if (!drawProcedural(ctx, cp, x, y, cellW, cellH)) {
      ctx.fillText(String.fromCodePoint(cp), x + cellW / 2, y + baseline);
    }
    ctx.restore();
    if (cp < LOOKUP_SIZE) lookup[cp] = i;
    else extra.set(cp, i);
  });

  const fallback = lookup['?'.charCodeAt(0)];
  const index = (cp: number) => {
    if (cp < LOOKUP_SIZE) {
      const v = lookup[cp];
      return v >= 0 ? v : fallback;
    }
    return extra.get(cp) ?? fallback;
  };
  const ramp = (s: string) => Uint16Array.from([...s].map((ch) => index(ch.codePointAt(0)!)));

  return { canvas, cellW, cellH, cols, codepoints, index, ramp, version: ++atlasVersion };
}

function drawProcedural(ctx: CanvasRenderingContext2D, cp: number, x: number, y: number, w: number, h: number): boolean {
  if (cp >= 0x2800 && cp <= 0x28ff) {
    drawBraille(ctx, cp - 0x2800, x, y, w, h);
    return true;
  }
  if (cp >= 0x2580 && cp <= 0x259f) {
    drawBlock(ctx, cp, x, y, w, h);
    return true;
  }
  const box = BOX[cp];
  if (box) {
    drawBox(ctx, cp, box, x, y, w, h);
    return true;
  }
  const shape = SHAPES[cp];
  if (shape) {
    drawShape(ctx, shape, x, y, w, h);
    return true;
  }
  return false;
}

// Braille bit order: dots 1-3 left column top-down, 4-6 right column, 7 and 8 bottom row.
const BRAILLE_DOTS: [number, number][] = [
  [0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2], [0, 3], [1, 3],
];

function drawBraille(ctx: CanvasRenderingContext2D, bits: number, x: number, y: number, w: number, h: number) {
  const r = Math.max(0.6, Math.min(w * 0.17, h * 0.085));
  for (let b = 0; b < 8; b++) {
    if (!(bits & (1 << b))) continue;
    const [cx, cy] = BRAILLE_DOTS[b];
    ctx.beginPath();
    ctx.arc(x + w * (0.3 + 0.4 * cx), y + h * (0.14 + 0.24 * cy), r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBlock(ctx: CanvasRenderingContext2D, cp: number, x: number, y: number, w: number, h: number) {
  const rect = (fx0: number, fy0: number, fx1: number, fy1: number) => {
    const x0 = Math.round(x + w * fx0), x1 = Math.round(x + w * fx1);
    const y0 = Math.round(y + h * fy0), y1 = Math.round(y + h * fy1);
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  };
  if (cp === 0x2580) return rect(0, 0, 1, 0.5);
  if (cp >= 0x2581 && cp <= 0x2588) return rect(0, 1 - (cp - 0x2580) / 8, 1, 1);
  if (cp >= 0x2589 && cp <= 0x258f) return rect(0, 0, (0x2590 - cp) / 8, 1);
  if (cp === 0x2590) return rect(0.5, 0, 1, 1);
  if (cp >= 0x2591 && cp <= 0x2593) {
    ctx.globalAlpha = (cp - 0x2590) * 0.25;
    rect(0, 0, 1, 1);
    ctx.globalAlpha = 1;
    return;
  }
  if (cp === 0x2594) return rect(0, 0, 1, 1 / 8);
  if (cp === 0x2595) return rect(7 / 8, 0, 1, 1);
  // Quadrants: bit 1 UL, 2 UR, 4 LL, 8 LR
  const Q: Record<number, number> = {
    0x2596: 4, 0x2597: 8, 0x2598: 1, 0x2599: 1 | 4 | 8, 0x259a: 1 | 8, 0x259b: 1 | 2 | 4,
    0x259c: 1 | 2 | 8, 0x259d: 2, 0x259e: 2 | 4, 0x259f: 2 | 4 | 8,
  };
  const q = Q[cp] ?? 0;
  if (q & 1) rect(0, 0, 0.5, 0.5);
  if (q & 2) rect(0.5, 0, 1, 0.5);
  if (q & 4) rect(0, 0.5, 0.5, 1);
  if (q & 8) rect(0.5, 0.5, 1, 1);
}

function drawBox(
  ctx: CanvasRenderingContext2D,
  cp: number,
  spec: [number, number, number, number] | 'diagA' | 'diagB' | 'diagX',
  x: number, y: number, w: number, h: number,
) {
  const t = Math.max(1, Math.round(w * 0.12));
  if (typeof spec === 'string') {
    ctx.lineWidth = t;
    ctx.beginPath();
    if (spec !== 'diagB') { ctx.moveTo(x + w, y); ctx.lineTo(x, y + h); }
    if (spec !== 'diagA') { ctx.moveTo(x, y); ctx.lineTo(x + w, y + h); }
    ctx.stroke();
    return;
  }
  const cx = Math.round(x + w / 2 - t / 2);
  const cy = Math.round(y + h / 2 - t / 2);
  const [u, d, l, r] = spec;
  const rounded = cp >= 0x256d && cp <= 0x2570;
  if (rounded) {
    ctx.lineWidth = t;
    ctx.beginPath();
    const mx = cx + t / 2, my = cy + t / 2;
    const rad = Math.min(w, h) / 2;
    const ex = r ? x + w : x;
    const ey = d ? y + h : y;
    ctx.moveTo(ex, my);
    ctx.arcTo(mx, my, mx, ey, rad);
    ctx.lineTo(mx, ey);
    ctx.stroke();
    return;
  }
  const seg = (weight: number, dir: 'u' | 'd' | 'l' | 'r') => {
    if (!weight) return;
    const tw = weight === 2 ? t * 2 : t;
    const offs = weight === 3 ? [-t, t] : [0];
    for (const o of offs) {
      if (dir === 'u' || dir === 'd') {
        const xx = cx + o - (tw - t) / 2;
        const y0 = dir === 'u' ? y : cy;
        const y1 = dir === 'u' ? cy + t : y + h;
        ctx.fillRect(xx, y0, tw, y1 - y0);
      } else {
        const yy = cy + o - (tw - t) / 2;
        const x0 = dir === 'l' ? x : cx;
        const x1 = dir === 'l' ? cx + t : x + w;
        ctx.fillRect(x0, yy, x1 - x0, tw);
      }
    }
  };
  seg(u, 'u'); seg(d, 'd'); seg(l, 'l'); seg(r, 'r');
}

function drawShape(ctx: CanvasRenderingContext2D, shape: string, x: number, y: number, w: number, h: number) {
  const cx = x + w / 2, cy = y + h / 2;
  const s = Math.min(w, h);
  ctx.beginPath();
  switch (shape) {
    case 'disc': ctx.arc(cx, cy, s * 0.4, 0, Math.PI * 2); ctx.fill(); break;
    case 'dot': ctx.arc(cx, cy, s * 0.14, 0, Math.PI * 2); ctx.fill(); break;
    case 'ring':
    case 'smallring':
      ctx.lineWidth = Math.max(1, s * 0.09);
      ctx.arc(cx, cy, s * (shape === 'ring' ? 0.36 : 0.22), 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'square': ctx.fillRect(cx - s * 0.38, cy - s * 0.38, s * 0.76, s * 0.76); break;
    case 'smallsquare': ctx.fillRect(cx - s * 0.22, cy - s * 0.22, s * 0.44, s * 0.44); break;
    case 'star': {
      const r1 = s * 0.46, r2 = s * 0.1;
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4 - Math.PI / 2;
        const r = i % 2 ? r2 : r1;
        const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
        if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
  }
}

/** Braille code point for a dot bitmask. */
export const brailleCp = (bits: number) => 0x2800 + bits;
