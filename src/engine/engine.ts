import { AudioEngine } from '../audio/audio';
import { SCENES, sceneById } from '../scenes';
import type { Store } from '../settings';
import { Compositor, StyledFrame, type TransitionType } from './compositor';
import { GhostClock } from './ghostclock';
import { buildAtlas, CELL_ASPECT, type Atlas } from './glyphs';
import { clamp, smoothstep, type RGB } from './math';
import type { FrameUniforms, Layout, Renderer } from './renderer';
import { Canvas2DRenderer } from './renderer-2d';
import { GLRenderer } from './renderer-gl';
import { randomSeed } from './rng';
import { paramDefaults, SceneRunner, SILENT_AUDIO } from './runner';
import { lerpPost, resolveStyle, styleById, type ResolvedStyle } from './styles';
import type { SceneDef } from './types';

const MAX_SIM_HZ = 30;

interface Transition {
  from: SceneRunner;
  to: SceneRunner;
  t: number;
  dur: number;
  type: TransitionType;
}

export interface EngineStats {
  fps: number;
  frameMs: number;
  tickMs: number;
  cols: number;
  rows: number;
  renderer: string;
}

/**
 * Owns the canvas, the renderer, the running scene(s), and the fixed-timestep loop.
 * The simulation ticks at up to 30 Hz; the GPU interpolates between ticks every frame.
 */
export class Engine {
  canvas: HTMLCanvasElement;
  renderer!: Renderer;
  atlas!: Atlas;
  layout!: Layout;
  compositor = new Compositor();
  audio = new AudioEngine();
  ghost = new GhostClock();
  current!: SceneRunner;
  transition: Transition | null = null;
  stats: EngineStats = { fps: 0, frameMs: 0, tickMs: 0, cols: 0, rows: 0, renderer: '' };
  frozenUntil = 0;
  reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  onBatteryPower = false;
  lastInput = performance.now();
  /** Called whenever the active scene changes (for console/status refresh). */
  onSceneChange: () => void = () => {};

  private frameA!: StyledFrame;
  private frameB!: StyledFrame;
  private out!: StyledFrame;
  private styleCache = new Map<string, ResolvedStyle>();
  private acc = 0;
  private lastFrame = 0;
  private elapsed = 0;
  private raf = 0;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private dimLevel = 1;
  private lastUniforms: FrameUniforms | null = null;
  private pendingCapture: ((c: HTMLCanvasElement) => void) | null = null;
  private atlasKey = '';
  private forced2d: boolean;

  constructor(private host: HTMLElement, readonly store: Store) {
    this.forced2d = new URLSearchParams(location.search).get('renderer') === '2d';
    this.canvas = this.makeCanvas();
    this.createRenderer();
    store.subscribe(() => this.styleCache.clear());
    matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
      this.reducedMotion = e.matches;
    });
    this.audio.sensitivity = store.s.audio.sensitivity;
    this.audio.smoothing = store.s.audio.smoothing;
  }

  private makeCanvas() {
    const c = document.createElement('canvas');
    c.className = 'stage';
    this.host.prepend(c);
    return c;
  }

  private createRenderer() {
    if (!this.forced2d) {
      try {
        this.renderer = new GLRenderer(this.canvas);
        this.canvas.addEventListener('webglcontextlost', () => this.watchContextLoss());
        return;
      } catch (e) {
        console.warn('WebGL2 unavailable, using Canvas 2D fallback', e);
        this.canvas.remove();
        this.canvas = this.makeCanvas();
      }
    }
    this.renderer = new Canvas2DRenderer(this.canvas);
  }

  /** If the GPU context doesn't come back, swap in a fresh canvas and renderer. */
  private watchContextLoss() {
    window.setTimeout(() => {
      if (!this.renderer.lost) return;
      this.renderer.dispose();
      this.canvas.remove();
      this.canvas = this.makeCanvas();
      this.createRenderer();
      this.atlasKey = '';
      this.relayout(true);
    }, 3000);
  }

  start() {
    const s = this.store.s;
    const def = sceneById(s.scene) ?? SCENES[0];
    this.relayout(true);
    this.current = this.makeRunner(def);
    new ResizeObserver(() => this.relayout()).observe(this.host);
    this.watchDpr();
    this.detectBattery();
    this.tick(0);
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private watchDpr() {
    const mq = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    mq.addEventListener('change', () => {
      this.relayout();
      this.watchDpr();
    }, { once: true });
  }

  private async detectBattery() {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ charging: boolean; addEventListener: (e: string, f: () => void) => void }> };
    if (!nav.getBattery) return;
    try {
      const b = await nav.getBattery();
      const upd = () => (this.onBatteryPower = !b.charging);
      upd();
      b.addEventListener('chargingchange', upd);
    } catch {
      /* not available */
    }
  }

  seedFor(id: string) {
    return this.store.s.seeds[id] ?? sceneById(id)?.defaultSeed ?? 1;
  }

  makeRunner(def: SceneDef, seed = this.seedFor(def.id)) {
    const L = this.layout;
    const params = paramDefaults(def, this.store.s.sceneParams[def.id]);
    this.store.s.sceneParams[def.id] = params;
    return new SceneRunner(def, seed, params, L.cols, L.rows, L.cellW / L.cellH, { reducedMotion: this.reducedMotion });
  }

  relayout(force = false) {
    const s = this.store.s;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(this.host.clientWidth * dpr));
    const height = Math.max(1, Math.round(this.host.clientHeight * dpr));
    const cellH = Math.max(6, Math.round(s.cellSize * dpr));
    const cellW = Math.max(3, Math.round(cellH * CELL_ASPECT));
    const margin = Math.round(8 * dpr);
    const cols = Math.ceil((width + margin * 2) / cellW);
    const rows = Math.ceil((height + margin * 2) / cellH);
    const key = `${cellW}x${cellH}`;
    if (!force && this.layout && this.layout.width === width && this.layout.height === height && this.atlasKey === key) return;
    this.layout = { width, height, cols, rows, cellW, cellH, originX: -margin, originY: -margin };
    if (this.atlasKey !== key) {
      this.atlas = buildAtlas(cellW, cellH);
      this.atlasKey = key;
      this.compositor.setAtlas(this.atlas);
      this.renderer.setAtlas(this.atlas);
    }
    this.renderer.resize(this.layout);
    this.compositor.resize(cols, rows);
    this.frameA = new StyledFrame(cols, rows);
    this.frameB = new StyledFrame(cols, rows);
    this.out = new StyledFrame(cols, rows);
    const aspect = cellW / cellH;
    this.current?.resize(cols, rows, aspect);
    if (this.transition) {
      this.transition.from.resize(cols, rows, aspect);
      this.transition.to.resize(cols, rows, aspect);
    }
    this.stats.cols = cols;
    this.stats.rows = rows;
    this.stats.renderer = this.renderer.kind === 'webgl2' ? 'WebGL2' : 'Canvas 2D';
    // Compose immediately so there's never a blank frame after a resize.
    if (this.current) this.tick(0);
  }

  /** Resolve the effective style for a scene (handles Auto and session overrides). */
  styleFor(def: SceneDef): ResolvedStyle {
    const s = this.store.s;
    const key = `${def.id}|${s.style}`;
    let r = this.styleCache.get(key);
    if (!r) {
      const auto = s.style === 'auto';
      const sd = styleById(auto ? def.recommended.style : s.style);
      r = resolveStyle(sd, {
        colorMode: s.colorMode, glyphSet: s.glyphSet, dither: s.dither, palette: s.palette,
        effects: s.effects, contrast: s.contrast,
      }, auto ? def.recommended.colorMode : undefined);
      this.styleCache.set(key, r);
    }
    return r;
  }

  get activeStyle() {
    return this.styleFor((this.transition?.to ?? this.current).def);
  }

  get activeDef() {
    return (this.transition?.to ?? this.current).def;
  }

  get activeRunner() {
    return this.transition?.to ?? this.current;
  }

  /** Switch scenes with a transition. */
  setScene(id: string, opts: { seed?: number; type?: TransitionType; secs?: number } = {}) {
    const def = sceneById(id);
    if (!def) return false;
    const s = this.store.s;
    if (this.transition) {
      // Snap the running transition to its end before starting another.
      this.current = this.transition.to;
      this.transition = null;
    }
    const to = this.makeRunner(def, opts.seed ?? this.seedFor(def.id));
    const secs = opts.secs ?? s.playlist.transitionSecs;
    this.transition = {
      from: this.current, to, t: 0,
      dur: Math.max(0.3, this.reducedMotion ? secs * 1.5 : secs),
      type: opts.type ?? s.playlist.transition,
    };
    if (s.scene !== id) this.store.update((st) => (st.scene = id));
    this.onSceneChange();
    return true;
  }

  reroll(seed = randomSeed()) {
    const id = this.activeDef.id;
    this.store.update((s) => (s.seeds[id] = seed));
    this.setScene(id, { seed, type: 'dissolve', secs: 1.6 });
  }

  /** Re-create the running scene (after a param that needs re-init). */
  restartScene() {
    const def = this.activeDef;
    this.transition = null;
    this.current = this.makeRunner(def);
    this.onSceneChange();
  }

  freeze(secs: number) {
    this.frozenUntil = performance.now() + secs * 1000;
  }

  get frozen() {
    return performance.now() < this.frozenUntil;
  }

  triggerEvent() {
    this.activeRunner.triggerEvent();
  }

  triggerClock() {
    this.ghost.trigger(new Date(), this.elapsed);
  }

  /** Resolves with the canvas right after a frame is drawn (so its pixels are valid). */
  capture(): Promise<HTMLCanvasElement> {
    return new Promise((res) => (this.pendingCapture = res));
  }

  text() {
    return this.compositor.toText(this.out);
  }

  private frameCap() {
    const s = this.store.s;
    let cap: number = s.display.frameCap;
    if (s.display.batterySaver && this.onBatteryPower) cap = cap === 0 ? 15 : Math.min(cap, 15);
    return cap;
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const cap = this.frameCap();
    if (cap > 0 && now - this.lastFrame < 1000 / cap - 2) return;
    const dt = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.renderer.lost) return;

    const simHz = cap > 0 ? Math.min(MAX_SIM_HZ, cap) : MAX_SIM_HZ;
    const simDt = 1 / simHz;
    const frozen = this.frozen;
    if (!frozen) this.acc += dt;
    let ticks = 0;
    while (this.acc >= simDt && ticks < 3) {
      const t0 = performance.now();
      this.tick(simDt);
      this.stats.tickMs = this.stats.tickMs * 0.9 + (performance.now() - t0) * 0.1;
      this.acc -= simDt;
      ticks++;
    }
    if (ticks === 3) this.acc = 0;
    const alpha = frozen ? 1 : clamp(this.acc / simDt);

    const t0 = performance.now();
    const u = this.uniforms(alpha, dt);
    this.renderer.draw(u);
    this.lastUniforms = u;
    if (this.pendingCapture) {
      this.pendingCapture(this.canvas);
      this.pendingCapture = null;
    }
    this.stats.frameMs = this.stats.frameMs * 0.9 + (performance.now() - t0) * 0.1;

    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 1) {
      this.stats.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
  };

  private tick(dt: number) {
    const s = this.store.s;
    this.elapsed += dt;
    const sceneDt = this.reducedMotion ? dt * 0.6 : dt;

    this.audio.sensitivity = s.audio.sensitivity;
    this.audio.smoothing = s.audio.smoothing;
    this.audio.update(dt);
    const audio = s.audio.enabled ? this.audio.frame : SILENT_AUDIO;
    const rare = s.display.rareEvents;

    this.ghost.check(new Date(), s.display.ghostClock, this.elapsed);
    const ghost = this.ghost.active;
    const aspect = this.layout.cellW / this.layout.cellH;

    const tr = this.transition;
    if (tr) {
      tr.t += dt / tr.dur;
      tr.from.tick(sceneDt, audio, false);
      tr.to.tick(sceneDt, audio, rare);
      if (ghost) {
        this.ghost.apply(tr.from.grid, this.elapsed, aspect);
        this.ghost.apply(tr.to.grid, this.elapsed, aspect);
      }
      if (tr.t >= 1) {
        this.current = tr.to;
        this.transition = null;
        this.compositor.style(this.current.grid, this.styleFor(this.current.def), this.out, s.sceneGlyphs);
      } else {
        const e = smoothstep(0, 1, tr.t);
        this.compositor.style(tr.from.grid, this.styleFor(tr.from.def), this.frameA, s.sceneGlyphs);
        this.compositor.style(tr.to.grid, this.styleFor(tr.to.def), this.frameB, s.sceneGlyphs);
        this.compositor.blend(this.frameA, this.frameB, e, tr.type, this.out);
      }
    } else {
      this.current.tick(sceneDt, audio, rare);
      if (ghost) this.ghost.apply(this.current.grid, this.elapsed, aspect);
      this.compositor.style(this.current.grid, this.styleFor(this.current.def), this.out, s.sceneGlyphs);
    }
    this.renderer.upload(this.out);
  }

  private uniforms(alpha: number, dt: number): FrameUniforms {
    const s = this.store.s;
    const now = performance.now() / 1000;
    let post;
    let edge: RGB;
    const tr = this.transition;
    if (tr) {
      const a = this.styleFor(tr.from.def), b = this.styleFor(tr.to.def);
      const e = smoothstep(0, 1, tr.t);
      post = lerpPost(a.post, b.post, e);
      edge = [a.bg[0] + (b.bg[0] - a.bg[0]) * e, a.bg[1] + (b.bg[1] - a.bg[1]) * e, a.bg[2] + (b.bg[2] - a.bg[2]) * e];
    } else {
      const st = this.styleFor(this.current.def);
      post = st.post;
      edge = st.bg;
    }

    let brightness = s.brightness;
    let warmth = 0;
    let peak = 1;
    if (s.display.breathing) brightness *= 1 - 0.035 * (0.5 + 0.5 * Math.sin((now * Math.PI * 2) / 150));
    if (s.display.followClock) {
      const d = new Date();
      const h = d.getHours() + d.getMinutes() / 60;
      // 1 deep at night, 0 through the middle of the day.
      const night = h < 12 ? 1 - smoothstep(5.5, 9, h) : smoothstep(18.5, 22.5, h);
      warmth = Math.max(warmth, 0.45 * night);
      brightness *= 1 - 0.3 * night;
    }
    if (s.display.nightMode) {
      warmth = Math.max(warmth, 0.6);
      peak = 0.55;
    }
    // Auto-dim after long periods without input.
    const idleH = (performance.now() - this.lastInput) / 3.6e6;
    const dimTarget = s.display.autoDimHours > 0 && idleH > s.display.autoDimHours ? 0.5 : 1;
    this.dimLevel += (dimTarget - this.dimLevel) * Math.min(1, dt * 0.2);
    brightness *= this.dimLevel;

    let driftX = 0, driftY = 0;
    if (s.display.drift) {
      const m = -this.layout.originX * 0.9;
      driftX = Math.sin((now * Math.PI * 2) / 1130) * m;
      driftY = Math.sin((now * Math.PI * 2) / 1710 + 1.3) * m;
    }
    return { alpha, post, brightness, warmth, peak, driftX, driftY, time: now, dt, edge };
  }

  get lastFrameUniforms() {
    return this.lastUniforms;
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }
}
