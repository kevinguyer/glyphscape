import { StyledFrame } from '../engine/compositor';
import type { Engine } from '../engine/engine';
import { FONT_FAMILY } from '../engine/glyphs';
import { paramDefaults, SceneRunner, SILENT_AUDIO } from '../engine/runner';
import type { SceneDef } from '../engine/types';

const TC = 34, TR = 10;
const CW = 7, CH = 12;

interface Thumb {
  def: SceneDef;
  runner: SceneRunner;
  frame: StyledFrame;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

/**
 * Live scene thumbnails for the console. Each scene runs a tiny instance of itself, styled by
 * the same compositor, drawn with fillText. Only runs while the Scene panel is visible.
 */
export class Thumbnails {
  private thumbs = new Map<string, Thumb>();
  private raf = 0;
  private last = 0;
  private running = false;

  constructor(private engine: Engine) {}

  canvasFor(def: SceneDef): HTMLCanvasElement {
    let t = this.thumbs.get(def.id);
    if (!t) {
      const canvas = document.createElement('canvas');
      const dpr = Math.min(2, devicePixelRatio || 1);
      canvas.width = TC * CW * dpr;
      canvas.height = TR * CH * dpr;
      canvas.className = 'thumb';
      const ctx = canvas.getContext('2d')!;
      ctx.scale(dpr, dpr);
      const runner = new SceneRunner(def, this.engine.seedFor(def.id), paramDefaults(def, this.engine.store.s.sceneParams[def.id]), TC, TR, CW / CH, { thumbnail: true });
      // Warm up so thumbnails aren't empty on first view.
      for (let i = 0; i < 45; i++) runner.tick(1 / 15, SILENT_AUDIO, false);
      t = { def, runner, frame: new StyledFrame(TC, TR), canvas, ctx };
      this.thumbs.set(def.id, t);
    }
    return t.canvas;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      if (now - this.last < 66) return;
      const dt = Math.min(0.2, (now - this.last) / 1000);
      this.last = now;
      for (const t of this.thumbs.values()) {
        if (!t.canvas.isConnected) continue;
        t.runner.tick(dt, SILENT_AUDIO, false);
        this.draw(t);
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private draw(t: Thumb) {
    const st = this.engine.styleFor(t.def);
    this.engine.compositor.style(t.runner.grid, st, t.frame, this.engine.store.s.sceneGlyphs);
    const { ctx, frame } = t;
    const cps = this.engine.atlas.codepoints;
    const bg = st.bg;
    ctx.fillStyle = `rgb(${bg[0] * 255},${bg[1] * 255},${bg[2] * 255})`;
    ctx.fillRect(0, 0, TC * CW, TR * CH);
    ctx.font = `${CH * 0.82}px ${FONT_FAMILY}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    for (let y = 0; y < TR; y++) {
      for (let x = 0; x < TC; x++) {
        const i = y * TC + x;
        const cp = cps[frame.glyph[i]];
        if (!cp || cp === 32) continue;
        const o = i * 4;
        const a = frame.fg[o + 3] / 255;
        if (a < 0.05) continue;
        ctx.fillStyle = `rgba(${frame.fg[o]},${frame.fg[o + 1]},${frame.fg[o + 2]},${a})`;
        ctx.fillText(String.fromCodePoint(cp), x * CW + CW / 2, y * CH + CH / 2 + 1);
      }
    }
  }
}
