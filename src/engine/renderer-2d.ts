import type { StyledFrame } from './compositor';
import type { Atlas } from './glyphs';
import type { FrameUniforms, Layout, Renderer } from './renderer';

/**
 * Canvas 2D fallback with reduced effects. Colors are painted once per frame as a scaled-up
 * cols x rows image, glyph masks are stamped from the atlas, and the two are combined with
 * 'destination-in'. No interpolation, glow, or CRT effects.
 */
export class Canvas2DRenderer implements Renderer {
  readonly kind = 'canvas2d' as const;
  lost = false;
  private ctx: CanvasRenderingContext2D;
  private atlas: Atlas | null = null;
  private layout: Layout | null = null;
  private colorCanvas = document.createElement('canvas');
  private bgCanvas = document.createElement('canvas');
  private maskCanvas = document.createElement('canvas');
  private frame: StyledFrame | null = null;
  private dirty = false;
  private lastOff = '';

  constructor(readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  setAtlas(atlas: Atlas) {
    this.atlas = atlas;
    this.dirty = true;
  }

  resize(layout: Layout) {
    this.layout = layout;
    this.canvas.width = layout.width;
    this.canvas.height = layout.height;
    this.colorCanvas.width = this.bgCanvas.width = layout.cols;
    this.colorCanvas.height = this.bgCanvas.height = layout.rows;
    this.maskCanvas.width = layout.cols * layout.cellW;
    this.maskCanvas.height = layout.rows * layout.cellH;
    this.dirty = true;
  }

  upload(frame: StyledFrame) {
    this.frame = frame;
    this.dirty = true;
  }

  draw(u: FrameUniforms) {
    const f = this.frame, L = this.layout, A = this.atlas;
    if (!f || !L || !A || f.cols !== L.cols || f.rows !== L.rows) return;
    const ox = Math.round(L.originX + u.driftX), oy = Math.round(L.originY + u.driftY);
    const off = `${ox},${oy},${u.brightness.toFixed(2)},${u.warmth.toFixed(2)}`;
    // Only redraw when a new tick arrived or the drift moved by a whole pixel.
    if (!this.dirty && off === this.lastOff) return;
    this.dirty = false;
    this.lastOff = off;
    const { cols, rows, cellW, cellH } = L;

    const cimg = new ImageData(f.fg as unknown as Uint8ClampedArray<ArrayBuffer>, cols, rows);
    this.colorCanvas.getContext('2d')!.putImageData(cimg, 0, 0);
    const bimg = new ImageData(f.bg as unknown as Uint8ClampedArray<ArrayBuffer>, cols, rows);
    this.bgCanvas.getContext('2d')!.putImageData(bimg, 0, 0);

    const m = this.maskCanvas.getContext('2d')!;
    m.globalCompositeOperation = 'source-over';
    m.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
    const src = A.canvas;
    for (let y = 0, i = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++, i++) {
        const g = f.glyph[i];
        if (g === 0 || f.fg[i * 4 + 3] < 4) continue;
        m.drawImage(src, (g % A.cols) * cellW, Math.floor(g / A.cols) * cellH, cellW, cellH, x * cellW, y * cellH, cellW, cellH);
      }
    }
    m.globalCompositeOperation = 'source-in';
    m.imageSmoothingEnabled = false;
    m.drawImage(this.colorCanvas, 0, 0, cols * cellW, rows * cellH);

    const c = this.ctx;
    c.imageSmoothingEnabled = false;
    c.fillStyle = `rgb(${u.edge.map((v) => Math.round(v * 255)).join(',')})`;
    c.fillRect(0, 0, L.width, L.height);
    c.drawImage(this.bgCanvas, ox, oy, cols * cellW, rows * cellH);
    c.drawImage(this.maskCanvas, ox, oy);
    const dim = 1 - Math.min(1, u.brightness);
    if (dim > 0.01 || u.warmth > 0.01) {
      c.fillStyle = `rgba(${Math.round(40 * u.warmth)},${Math.round(14 * u.warmth)},0,${Math.max(dim, u.warmth * 0.35)})`;
      c.fillRect(0, 0, L.width, L.height);
    }
  }

  dispose() {}
}
