import type { Engine } from './engine/engine';
import { randomSeed } from './engine/rng';
import { STYLES, styleById } from './engine/styles';
import { sceneById, visibleScenes } from './scenes';
import type { Preset, Store } from './settings';

/** Ids for style cycling: Auto first, then every style. */
export const STYLE_CYCLE = ['auto', ...STYLES.map((s) => s.id)];

type Listener = (msg: string) => void;

/**
 * The control surface shared by the console, the terminal, hotkeys and the playlist.
 * Every user-facing action goes through here so they all behave the same.
 */
export class App {
  private toastListeners = new Set<Listener>();
  onPostcard: () => void = () => {};
  /** Called after any scene change (manual or playlist), e.g. to restart the playlist timer. */
  onSceneSet: () => void = () => {};

  constructor(public store: Store, public engine: Engine) {}

  get s() {
    return this.store.s;
  }

  toast(msg: string) {
    this.toastListeners.forEach((l) => l(msg));
  }

  onToast(l: Listener) {
    this.toastListeners.add(l);
  }

  scenes() {
    return visibleScenes(this.s.secretUnlocked);
  }

  setScene(id: string, opts?: { seed?: number }) {
    const def = sceneById(id);
    if (!def || (def.hidden && !this.s.secretUnlocked)) return false;
    const ok = this.engine.setScene(id, opts);
    if (ok) this.onSceneSet();
    return ok;
  }

  stepScene(dir: number) {
    const list = this.scenes().filter((d) => !d.hidden || d.id === this.engine.activeDef.id);
    const i = list.findIndex((d) => d.id === this.engine.activeDef.id);
    const next = list[(i + dir + list.length) % list.length];
    this.setScene(next.id);
  }

  shuffleScene() {
    const list = this.scenes().filter((d) => !d.hidden && d.id !== this.engine.activeDef.id);
    this.setScene(list[Math.floor(Math.random() * list.length)].id);
  }

  setStyle(id: string) {
    if (id !== 'auto' && !STYLES.some((s) => s.id === id)) return false;
    this.store.update((s) => (s.style = id));
    return true;
  }

  stepStyle(dir: number) {
    const i = STYLE_CYCLE.indexOf(this.s.style);
    const id = STYLE_CYCLE[(i + dir + STYLE_CYCLE.length) % STYLE_CYCLE.length];
    this.setStyle(id);
    this.toast(this.styleLabel());
  }

  styleLabel() {
    const def = this.engine.activeDef;
    return this.s.style === 'auto' ? `Auto · ${styleById(def.recommended.style).name}` : styleById(this.s.style).name;
  }

  reroll() {
    this.engine.reroll(randomSeed());
  }

  setSeed(seed: number) {
    this.engine.reroll(Math.max(1, Math.floor(seed)));
  }

  setParam(key: string, value: number) {
    const id = this.engine.activeDef.id;
    this.store.update((s) => {
      s.sceneParams[id] = s.sceneParams[id] ?? {};
      s.sceneParams[id][key] = value;
    });
    // The running scene reads its params object live.
    const r = this.engine.activeRunner;
    r.ctx.params[key] = value;
  }

  resetParams() {
    const def = this.engine.activeDef;
    for (const p of def.params) this.setParam(p.key, p.default);
  }

  setCellSize(px: number) {
    this.store.update((s) => (s.cellSize = Math.max(8, Math.min(40, Math.round(px)))));
    this.engine.relayout();
  }

  currentAsPreset(name: string): Preset {
    const def = this.engine.activeDef;
    return {
      id: `p-${Date.now().toString(36)}`,
      name,
      scene: def.id,
      style: this.s.style,
      colorMode: this.s.colorMode,
      glyphSet: this.s.glyphSet,
      palette: this.s.palette ? { ...this.s.palette } : null,
      seed: this.engine.activeRunner.seed,
      params: { ...this.engine.activeRunner.ctx.params },
      cellSize: this.s.cellSize,
    };
  }

  savePreset(name?: string) {
    const p = this.currentAsPreset(name?.trim() || `${this.engine.activeDef.name} ${this.s.presets.length + 1}`);
    this.store.update((s) => s.presets.push(p));
    this.toast(`Saved preset ${this.s.presets.length}: ${p.name}`);
    return p;
  }

  applyPreset(p: Preset, quiet = false) {
    const def = sceneById(p.scene);
    if (!def) return;
    this.store.update((s) => {
      s.style = p.style;
      s.colorMode = p.colorMode;
      s.glyphSet = p.glyphSet;
      s.palette = p.palette ? { ...p.palette } : null;
      s.seeds[p.scene] = p.seed;
      s.sceneParams[p.scene] = { ...(s.sceneParams[p.scene] ?? {}), ...p.params };
      if (p.cellSize) s.cellSize = p.cellSize;
    });
    if (p.cellSize) this.engine.relayout();
    this.engine.setScene(p.scene, { seed: p.seed });
    this.onSceneSet();
    if (!quiet) this.toast(p.name);
  }

  loadPresetIndex(i: number) {
    const p = this.s.presets[i];
    if (p) this.applyPreset(p);
  }

  postcard() {
    this.engine.freeze(5);
    this.onPostcard();
  }

  async photo(kind: 'png' | 'txt') {
    const name = `glyphscape-${this.engine.activeDef.id}-${this.engine.activeRunner.seed}`;
    if (kind === 'txt') {
      const text = this.engine.text();
      download(new Blob([text], { type: 'text/plain' }), `${name}.txt`);
      try {
        await navigator.clipboard.writeText(text);
        this.toast('Frame saved as text and copied');
      } catch {
        this.toast('Frame saved as text');
      }
      return;
    }
    const canvas = await this.engine.capture();
    canvas.toBlob((b) => b && download(b, `${name}.png`), 'image/png');
    this.toast('Frame saved as PNG');
  }

  unlockSecret() {
    this.store.update((s) => (s.secretUnlocked = true));
    this.setScene('probe');
    this.toast('Secret scene unlocked: Von Neumann');
  }
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
