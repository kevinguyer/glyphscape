import type { Ambient } from '../ambient';
import { download, STYLE_CYCLE, type App } from '../app';
import type { AudioStatus } from '../audio/audio';
import { GLYPH_SETS } from '../engine/glyphs';
import { rgbToHex } from '../engine/math';
import { COLOR_MODES, styleById } from '../engine/styles';
import type { Playlist } from '../playlist';
import { sceneById } from '../scenes';
import { defaultSettings, type Preset } from '../settings';
import { bar, button, buttons, choice, colorRow, h, heading, info, monoEl, setMono, slider, toggle, type Row } from './controls';
import { Thumbnails } from './thumbs';

export const CONSOLE_W = 66; // characters, including the frame

interface Panel {
  id: string;
  title: string;
  build(): Row[];
}

const AUDIO_STATUS: Record<AudioStatus, string> = {
  off: 'off',
  starting: 'waiting for permission…',
  listening: 'listening',
  'no-signal': 'no signal detected, scenes move normally',
  denied: 'permission denied, scenes move normally',
  unsupported: 'not supported in this browser',
  'no-audio-track': 'no audio was shared (tick “Share audio”)',
  error: 'could not start audio',
};

const fmtTime = (s: number) => {
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  const hh = Math.floor(s / 3600), mm = Math.round((s % 3600) / 60);
  return mm ? `${hh} h ${mm} min` : `${hh} h`;
};

/**
 * The translucent ASCII console. Opens over the live scene; every change applies instantly.
 * Fully keyboard operable: Tab switches panels, arrows move and adjust, Enter activates.
 */
export class Console {
  root: HTMLElement;
  isOpen = false;
  private body: HTMLElement;
  private headerStatus: HTMLElement;
  private welcome: HTMLElement;
  private tabsEl: HTMLElement;
  private panels: Panel[];
  private active = 0;
  private rows: Row[] = [];
  private liveTimer = 0;
  private hideTimer = 0;
  private thumbs: Thumbnails;
  private capturingKey = false;
  private confirmDelete = -1;

  constructor(private app: App, private ambient: Ambient, private playlist: Playlist, private openTerminal: () => void) {
    this.thumbs = new Thumbnails(app.engine);
    this.root = h('div', 'console');
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-label', 'Glyphscape console');
    this.root.hidden = true;

    const top = monoEl('div', 'frame-line', `┌${'─'.repeat(CONSOLE_W - 2)}┐`);
    const title = h('div', 'title');
    title.append(h('span', 'brand', ' GLYPHSCAPE '), (this.headerStatus = h('span', 'status')));
    this.welcome = h('div', 'welcome');
    this.welcome.innerHTML =
      'Welcome. This is living ASCII art for a spare screen.<br>' +
      'Press <b>`</b> (backtick) any time to open or close this console, <b>Esc</b> to close.<br>' +
      '<b>←/→</b> change scene, <b>↑/↓</b> change style, <b>F</b> fullscreen, <b>P</b> postcard.<br>' +
      'Everything saves automatically. Close this and let it run.';
    this.tabsEl = h('div', 'tabs');
    this.tabsEl.setAttribute('role', 'tablist');
    this.body = h('div', 'panel');
    const footer = monoEl('div', 'footer', '` close · tab panels · ↑↓ move · ←→ adjust · ⏎ select · / command');
    const bottom = monoEl('div', 'frame-line', `└${'─'.repeat(CONSOLE_W - 2)}┘`);
    const inner = h('div', 'inner');
    inner.append(title, this.welcome, this.tabsEl, this.body, footer);
    this.root.append(top, inner, bottom);

    this.panels = [
      { id: 'scene', title: 'Scene', build: () => this.scenePanel() },
      { id: 'style', title: 'Style', build: () => this.stylePanel() },
      { id: 'motion', title: 'Motion', build: () => this.motionPanel() },
      { id: 'playlist', title: 'Playlist', build: () => this.playlistPanel() },
      { id: 'audio', title: 'Audio', build: () => this.audioPanel() },
      { id: 'display', title: 'Display', build: () => this.displayPanel() },
      { id: 'presets', title: 'Presets', build: () => this.presetsPanel() },
    ];
    this.panels.forEach((p, i) => {
      const t = h('span', 'tab', ` ${p.title.toUpperCase()} `);
      t.setAttribute('role', 'tab');
      t.addEventListener('click', () => this.showPanel(i));
      this.tabsEl.append(t);
    });

    // Any interaction inside the console resets the auto-hide timer.
    for (const ev of ['pointermove', 'pointerdown', 'wheel', 'keydown', 'focusin']) {
      this.root.addEventListener(ev, () => this.bumpHide(), { passive: true });
    }
    app.store.subscribe(() => this.refresh());
    app.engine.onSceneChange = () => {
      if (this.isOpen && (this.panels[this.active].id === 'motion' || this.panels[this.active].id === 'scene')) this.rebuild();
      else this.refresh();
    };
    app.engine.audio.onStatus = () => this.refresh();
    ambient.onChange = () => this.refresh();
    document.body.append(this.root);
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.ambient.consoleOpen = true;
    this.ambient.showCursor();
    this.root.hidden = false;
    this.welcome.hidden = this.app.s.firstRunDone;
    requestAnimationFrame(() => this.root.classList.add('open'));
    this.showPanel(this.active, true);
    this.liveTimer = window.setInterval(() => this.liveUpdate(), 200);
    this.bumpHide();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.ambient.consoleOpen = false;
    this.ambient.showCursor();
    this.root.classList.remove('open');
    clearInterval(this.liveTimer);
    clearTimeout(this.hideTimer);
    this.thumbs.stop();
    this.capturingKey = false;
    if (!this.app.s.firstRunDone) this.app.store.update((s) => (s.firstRunDone = true));
    if (this.root.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
    window.setTimeout(() => {
      if (!this.isOpen) this.root.hidden = true;
    }, 500);
  }

  get capturing() {
    return this.capturingKey;
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  private bumpHide() {
    clearTimeout(this.hideTimer);
    const secs = this.app.s.console.autoHideSecs;
    // The first-run welcome stays until the user closes it.
    if (!this.isOpen || secs <= 0 || !this.app.s.firstRunDone) return;
    this.hideTimer = window.setTimeout(() => {
      // Never auto-hide while the user is typing or rebinding.
      if (this.capturingKey || document.activeElement?.tagName === 'INPUT') return this.bumpHide();
      this.close();
    }, secs * 1000);
  }

  private showPanel(i: number, keepFocus = false) {
    this.active = (i + this.panels.length) % this.panels.length;
    [...this.tabsEl.children].forEach((t, k) => {
      t.classList.toggle('active', k === this.active);
      t.setAttribute('aria-selected', String(k === this.active));
    });
    this.rebuild();
    if (!keepFocus || !this.root.contains(document.activeElement)) this.focusRow(0);
  }

  private rebuild() {
    const focusedIdx = this.focusables().indexOf(document.activeElement as HTMLElement);
    this.body.textContent = '';
    this.rows = this.panels[this.active].build();
    for (const r of this.rows) {
      if (r.mount === null) continue;
      this.body.append(r.mount ?? r.el);
      r.update();
    }
    if (this.panels[this.active].id === 'scene') this.thumbs.start();
    else this.thumbs.stop();
    this.refreshHeader();
    if (focusedIdx >= 0) this.focusRow(focusedIdx);
  }

  /** Re-render values without rebuilding (keeps focus). */
  refresh() {
    if (!this.isOpen) return;
    this.rows.forEach((r) => r.update());
    this.refreshHeader();
  }

  private liveUpdate() {
    for (const r of this.rows) if (r.live) r.update();
    this.refreshHeader();
  }

  private refreshHeader() {
    const e = this.app.engine;
    const wake = this.ambient.wake === 'active' ? '◉ awake' : this.app.s.display.wakeLock ? '○ no wake lock' : '';
    const audio = this.app.s.audio.enabled ? ` · ♪ ${e.audio.status === 'listening' ? 'on' : e.audio.status}` : '';
    setMono(this.headerStatus, `${e.activeDef.name} · ${this.app.styleLabel()} · seed ${e.activeRunner.seed}  ${wake}${audio}`);
    const st = e.activeStyle;
    const fg = rgbToHex(st.fg);
    this.root.style.setProperty('--accent', st.light ? '#2a2620' : fg);
    this.root.classList.toggle('light', st.light);
  }

  private focusables(): HTMLElement[] {
    return this.rows.filter((r) => r.focusable).map((r) => r.el);
  }

  private focusRow(i: number) {
    const f = this.focusables();
    if (!f.length) return;
    const el = f[Math.max(0, Math.min(f.length - 1, i))];
    el.focus({ preventScroll: false });
    el.scrollIntoView({ block: 'nearest' });
  }

  private rowFor(el: Element | null): Row | undefined {
    return this.rows.find((r) => r.el === el);
  }

  /** Console keyboard handling. Returns true if the key was consumed. */
  handleKey(e: KeyboardEvent): boolean {
    if (!this.isOpen) return false;
    if (this.capturingKey) {
      if (e.key === 'Escape') {
        this.capturingKey = false;
      } else if (e.key.length === 1) {
        const key = e.key;
        this.app.store.update((s) => (s.console.hotkey = key));
        this.capturingKey = false;
      }
      this.refresh();
      return true;
    }
    const f = this.focusables();
    const cur = f.indexOf(document.activeElement as HTMLElement);
    const row = this.rowFor(document.activeElement);
    if (row?.key?.(e)) return true;
    switch (e.key) {
      case 'Tab':
        this.showPanel(this.active + (e.shiftKey ? -1 : 1));
        return true;
      case 'ArrowDown':
        this.focusRow(cur < 0 ? 0 : cur + 1);
        return true;
      case 'ArrowUp':
        this.focusRow(cur < 0 ? 0 : cur - 1);
        return true;
      case 'ArrowLeft':
      case 'ArrowRight': {
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        if (row?.adjust) row.adjust(dir, e.shiftKey);
        else this.focusRow(cur < 0 ? 0 : cur + dir);
        return true;
      }
      case 'PageUp':
      case 'PageDown':
        row?.adjust?.(e.key === 'PageUp' ? 1 : -1, true);
        return true;
      case 'Home':
        this.focusRow(0);
        return true;
      case 'End':
        this.focusRow(f.length - 1);
        return true;
      case 'Enter':
      case ' ':
        if (row?.activate) {
          row.activate();
          return true;
        }
        return false;
    }
    return false;
  }

  // ---------------------------------------------------------------- panels

  private scenePanel(): Row[] {
    const app = this.app;
    const rows: Row[] = [];
    const grid = h('div', 'scene-grid');
    rows.push({ el: grid, focusable: false, update() {} });
    for (const def of app.scenes()) {
      const card = h('div', 'card');
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `${def.name}: ${def.blurb}`);
      const name = h('div', 'card-name');
      card.append(this.thumbs.canvasFor(def), name);
      grid.append(card);
      const select = () => app.setScene(def.id);
      const fav = () =>
        app.store.update((s) => {
          const f = s.playlist.favorites;
          const i = f.indexOf(def.id);
          if (i >= 0) f.splice(i, 1);
          else f.push(def.id);
        });
      card.addEventListener('click', (ev) => {
        if ((ev.target as HTMLElement).classList.contains('star')) fav();
        else select();
      });
      rows.push({
        el: card,
        mount: null,
        focusable: true,
        update() {
          const isFav = app.s.playlist.favorites.includes(def.id);
          const active = app.engine.activeDef.id === def.id;
          name.innerHTML = '';
          name.append(monoEl('span', '', `${active ? '▸' : ' '} ${def.name}`), monoEl('span', 'star', isFav ? ' ★' : ' ☆'));
          card.classList.toggle('active', active);
        },
        activate: select,
        key(e) {
          if (e.key === '*' || e.key === 's') {
            fav();
            return true;
          }
          return false;
        },
      });
    }
    rows.push(info(() => {
      const d = app.engine.activeDef;
      return `${d.name} · ${d.family} · ${d.blurb}`;
    }, 'info dim'));
    rows.push(...buttons([
      { label: 'Shuffle', action: () => app.shuffleScene() },
      { label: 'Rare event now', action: () => app.engine.triggerEvent() },
    ]));
    rows.push(info(() => 'Enter selects · * favorites · favorites weight the playlist shuffle', 'info dim'));
    return rows;
  }

  private stylePanel(): Row[] {
    const app = this.app;
    const s = () => app.s;
    const st = () => app.engine.activeStyle;
    const upd = (fn: (x: ReturnType<typeof s>) => void) => app.store.update(fn);
    const palette = (key: 'fg' | 'bg') => colorRow(key === 'fg' ? 'Foreground' : 'Background',
      () => rgbToHex(key === 'fg' ? st().fg : st().bg),
      (hex) => upd((x) => (x.palette = { ...(x.palette ?? {}), [key]: hex })));
    const baseDef = () => styleById(s().style === 'auto' ? app.engine.activeDef.recommended.style : s().style);
    const stopRow = (i: number) => colorRow(`Gradient ${i + 1}`,
      () => (s().palette?.stops ?? baseDef().palette.stops)[i] ?? '#000000',
      (hex) => upd((x) => {
        const stops = [...(x.palette?.stops ?? baseDef().palette.stops)];
        stops[i] = hex;
        x.palette = { ...(x.palette ?? {}), stops };
      }));
    const duoRow = (i: number) => colorRow(`Duotone ${i ? 'B' : 'A'}`,
      () => (s().palette?.duo ?? baseDef().palette.duo)[i],
      (hex) => upd((x) => {
        const duo = [...(x.palette?.duo ?? baseDef().palette.duo)] as [string, string];
        duo[i] = hex;
        x.palette = { ...(x.palette ?? {}), duo };
      }));
    const rows: Row[] = [
      choice({
        label: 'Style',
        options: () => STYLE_CYCLE.map((id) => ({
          id,
          label: id === 'auto' ? `Auto (${styleById(app.engine.activeDef.recommended.style).name})` : styleById(id).name,
        })),
        get: () => s().style,
        set: (v) => app.setStyle(v),
      }),
      info(() => (s().style === 'auto' ? 'Auto uses each scene\'s recommended look' : styleById(s().style).blurb), 'info dim'),
      choice({
        label: 'Color mode',
        options: [{ id: 'style', label: 'Style default' }, ...COLOR_MODES.map((m) => ({ id: m.id, label: m.name }))],
        get: () => s().colorMode,
        set: (v) => upd((x) => (x.colorMode = v)),
      }),
      choice({
        label: 'Glyph set',
        options: [{ id: 'style', label: 'Style default' }, ...Object.entries(GLYPH_SETS).map(([id, g]) => ({ id: id as never, label: g.name }))],
        get: () => s().glyphSet,
        set: (v) => upd((x) => (x.glyphSet = v)),
      }),
      choice({
        label: 'Dithering',
        options: [{ id: 'style', label: 'Style default' }, { id: 'none', label: 'None' }, { id: 'ordered', label: 'Ordered' }, { id: 'blue', label: 'Blue noise' }],
        get: () => s().dither,
        set: (v) => upd((x) => (x.dither = v)),
      }),
      slider({ label: 'Brightness', min: 0.2, max: 1.5, step: 0.01, get: () => s().brightness, set: (v) => upd((x) => (x.brightness = v)) }),
      slider({ label: 'Contrast', min: 0.5, max: 2.5, step: 0.01, get: () => s().contrast, set: (v) => upd((x) => (x.contrast = v)) }),
      slider({ label: 'Effects', min: 0, max: 1.5, step: 0.01, get: () => s().effects, set: (v) => upd((x) => (x.effects = v)) }),
      toggle('Scene glyphs', () => s().sceneGlyphs, (v) => upd((x) => (x.sceneGlyphs = v))),
      heading('palette'),
      palette('fg'),
      palette('bg'),
      duoRow(0),
      duoRow(1),
      ...[0, 1, 2, 3].map(stopRow),
      button('Reset palette', () => upd((x) => (x.palette = null)), s().palette ? 'custom palette active' : ''),
    ];
    return rows;
  }

  private motionPanel(): Row[] {
    const app = this.app;
    const def = app.engine.activeDef;
    const rows: Row[] = [
      slider({ label: 'Cell size', min: 8, max: 40, step: 1, get: () => app.s.cellSize, set: (v) => app.setCellSize(v), fmt: (v) => `${v}px` }),
      heading(def.name.toLowerCase()),
    ];
    for (const p of def.params) {
      rows.push(slider({
        label: p.label,
        min: p.min,
        max: p.max,
        step: p.step ?? (p.max - p.min) / 100,
        get: () => app.engine.activeRunner.ctx.params[p.key] ?? p.default,
        set: (v) => app.setParam(p.key, v),
      }));
    }
    const seedRow: Row = {
      ...info(() => `Seed           ${app.engine.activeRunner.seed}   ←/→ step · ⏎ reroll`, 'row'),
      focusable: true,
    };
    seedRow.el.tabIndex = 0;
    seedRow.el.classList.remove('static');
    seedRow.el.setAttribute('role', 'button');
    seedRow.adjust = (dir) => app.setSeed(app.engine.activeRunner.seed + dir);
    seedRow.activate = () => app.reroll();
    seedRow.el.addEventListener('click', () => app.reroll());
    rows.push(seedRow);
    rows.push(...buttons([
      { label: 'Reroll seed', action: () => app.reroll() },
      { label: 'Reset parameters', action: () => app.resetParams() },
    ]));
    return rows;
  }

  private playlistPanel(): Row[] {
    const app = this.app;
    const p = () => app.s.playlist;
    const upd = (fn: (x: ReturnType<typeof p>) => void) => app.store.update((s) => fn(s.playlist));
    // Interval: 30 s .. 2 h on a log scale
    const toFrac = (v: number) => Math.log(v / 30) / Math.log(7200 / 30);
    const fromFrac = (f: number) => 30 * Math.pow(7200 / 30, f);
    return [
      toggle('Cycle', () => p().enabled, (v) => {
        upd((x) => (x.enabled = v));
        this.playlist.reset();
      }, () => (p().enabled ? `next in ${fmtTime(Math.max(0, this.playlist.remaining))}` : 'staying on this scene')),
      slider({
        label: 'Interval', min: 30, max: 7200, step: 1, toFrac, fromFrac,
        get: () => p().interval,
        set: (v) => {
          const snapped = v < 120 ? Math.round(v / 10) * 10 : v < 3600 ? Math.round(v / 60) * 60 : Math.round(v / 300) * 300;
          upd((x) => (x.interval = snapped));
          this.playlist.reset();
        },
        fmt: fmtTime,
      }),
      choice({ label: 'Order', options: [{ id: 'shuffle', label: 'Shuffle' }, { id: 'sequential', label: 'Sequential' }], get: () => p().order, set: (v) => upd((x) => (x.order = v)) }),
      choice({
        label: 'Source',
        options: [{ id: 'scenes', label: 'All scenes' }, { id: 'favorites', label: 'Favorites' }, { id: 'presets', label: 'Presets' }],
        get: () => p().source,
        set: (v) => upd((x) => (x.source = v)),
      }),
      choice({
        label: 'Transition',
        options: [{ id: 'dissolve', label: 'Glyph dissolve' }, { id: 'crossfade', label: 'Crossfade' }, { id: 'wipe', label: 'Wipe' }],
        get: () => p().transition,
        set: (v) => upd((x) => (x.transition = v)),
      }),
      slider({ label: 'Transition time', min: 1, max: 12, step: 0.5, get: () => p().transitionSecs, set: (v) => upd((x) => (x.transitionSecs = v)), fmt: (v) => `${v.toFixed(1)} s` }),
      button('Next now', () => this.playlist.next()),
      info(() => {
        const fav = p().favorites.map((id) => sceneById(id)?.name).filter(Boolean);
        return `Favorites: ${fav.length ? fav.join(', ') : 'none yet (star scenes in the Scene panel)'}`;
      }, 'info dim'),
    ];
  }

  private audioPanel(): Row[] {
    const app = this.app;
    const a = () => app.s.audio;
    const eng = app.engine.audio;
    const upd = (fn: (x: ReturnType<typeof a>) => void) => app.store.update((s) => fn(s.audio));
    const start = () => eng.start(a().source);
    return [
      toggle('Reactive', () => a().enabled, (v) => {
        upd((x) => (x.enabled = v));
        if (v) start();
        else eng.stop();
      }, () => (a().enabled ? AUDIO_STATUS[eng.status] : '')),
      choice({
        label: 'Input',
        options: [{ id: 'mic', label: 'Microphone' }, { id: 'tab', label: 'Tab / system audio' }],
        get: () => a().source,
        set: (v) => {
          upd((x) => (x.source = v));
          if (a().enabled) start();
        },
      }),
      slider({ label: 'Sensitivity', min: 0.2, max: 3, step: 0.05, get: () => a().sensitivity, set: (v) => upd((x) => (x.sensitivity = v)) }),
      slider({ label: 'Smoothing', min: 0, max: 1, step: 0.01, get: () => a().smoothing, set: (v) => upd((x) => (x.smoothing = v)) }),
      heading('level'),
      info(() => {
        const f = eng.frame;
        const names = ['bass', 'low', 'high', 'treble'];
        return names.map((n, i) => `${n.padEnd(6)} ${bar(f.bands[i], 8)}`).slice(0, 2).join('   ');
      }, 'row static meter', true),
      info(() => {
        const f = eng.frame;
        const names = ['bass', 'low', 'high', 'treble'];
        return names.map((n, i) => `${n.padEnd(6)} ${bar(f.bands[i], 8)}`).slice(2).join('   ');
      }, 'row static meter', true),
      info(() => `level  ${bar(eng.frame.level, 24)}  beat ${eng.frame.beat > 0.3 ? '●' : '○'}`, 'row static meter', true),
      info(() => 'Privacy: audio is analyzed in memory only. Nothing is recorded, stored, or sent anywhere.', 'info dim'),
      info(() => 'Tab audio works best in Chrome and Edge: pick a tab and tick “Share audio”.', 'info dim'),
    ];
  }

  private displayPanel(): Row[] {
    const app = this.app;
    const d = () => app.s.display;
    const upd = (fn: (x: ReturnType<typeof d>) => void) => app.store.update((s) => fn(s.display));
    const wakeNote = () => ({
      off: 'off', active: 'screen stays awake', denied: 'denied: display may sleep',
      unsupported: 'unsupported: display may sleep', released: 'released, retries when visible',
    })[this.ambient.wake];
    const keyRow = button(`Console key: ${app.s.console.hotkey === ' ' ? 'space' : app.s.console.hotkey}`, () => {
      this.capturingKey = true;
      keyRow.el.firstElementChild!.textContent = '[ press a key… (Esc cancels) ]';
    });
    keyRow.update = () => {
      if (!this.capturingKey) keyRow.el.firstElementChild!.textContent = `[ Console key: ${app.s.console.hotkey} ]`;
    };
    return [
      button(this.ambient.fullscreen ? 'Exit fullscreen (F)' : 'Fullscreen (F)', () => this.ambient.toggleFullscreen()),
      choice({
        label: 'Frame cap',
        options: [{ id: 15, label: '15 fps' }, { id: 30, label: '30 fps' }, { id: 60, label: '60 fps' }, { id: 0, label: 'Uncapped' }],
        get: () => d().frameCap,
        set: (v) => upd((x) => (x.frameCap = v as 15 | 30 | 60 | 0)),
      }),
      toggle('Night mode', () => d().nightMode, (v) => upd((x) => (x.nightMode = v)), () => (d().nightMode ? 'dim and warm' : '')),
      toggle('Follow clock', () => d().followClock, (v) => upd((x) => (x.followClock = v)), () => 'warmer and dimmer at night'),
      toggle('Wake lock', () => d().wakeLock, (v) => {
        upd((x) => (x.wakeLock = v));
        this.ambient.syncWakeLock();
      }, wakeNote),
      toggle('Battery saver', () => d().batterySaver, (v) => upd((x) => (x.batterySaver = v)), () => (app.engine.onBatteryPower ? 'on battery: 15 fps' : '15 fps on battery')),
      heading('burn-in care'),
      toggle('Pixel drift', () => d().drift, (v) => upd((x) => (x.drift = v)), () => 'a few pixels per minute'),
      toggle('Breathing', () => d().breathing, (v) => upd((x) => (x.breathing = v)), () => 'slow ±3% brightness'),
      choice({
        label: 'Auto-dim',
        options: [{ id: 0, label: 'Off' }, { id: 1, label: 'After 1 h idle' }, { id: 2, label: 'After 2 h idle' }, { id: 4, label: 'After 4 h idle' }],
        get: () => d().autoDimHours,
        set: (v) => upd((x) => (x.autoDimHours = v)),
      }),
      info(() => 'OLED screens: keep drift and breathing on, and consider auto-dim.', 'info dim'),
      heading('surprises'),
      toggle('Ghost clock', () => d().ghostClock, (v) => upd((x) => (x.ghostClock = v)), () => 'the time, once an hour'),
      toggle('Rare events', () => d().rareEvents, (v) => upd((x) => (x.rareEvents = v)), () => 'about once an hour'),
      heading('console'),
      keyRow,
      choice({
        label: 'Auto-hide',
        options: [{ id: 0, label: 'Never' }, { id: 5, label: 'After 5 s' }, { id: 10, label: 'After 10 s' }, { id: 20, label: 'After 20 s' }, { id: 30, label: 'After 30 s' }],
        get: () => app.s.console.autoHideSecs,
        set: (v) => app.store.update((s) => (s.console.autoHideSecs = v)),
      }),
      info(() => {
        const st = app.engine.stats;
        const rm = app.engine.reducedMotion ? ' · reduced motion' : '';
        return `${st.renderer} · ${st.fps.toFixed(0)} fps · ${st.cols}×${st.rows} cells · sim ${st.tickMs.toFixed(1)} ms${rm}`;
      }, 'info dim', true),
      button('Reset all settings', () => {
        if (confirm('Reset all settings and presets to defaults?')) {
          app.store.reset();
          app.engine.relayout(true);
          app.setScene(defaultSettings().scene);
        }
      }),
    ];
  }

  private presetsPanel(): Row[] {
    const app = this.app;
    const rows: Row[] = [];
    rows.push(...buttons([
      { label: 'Save current', action: () => {
        const name = prompt('Preset name', `${app.engine.activeDef.name} · ${app.styleLabel()}`);
        if (name !== null) {
          app.savePreset(name);
          this.rebuild();
        }
      } },
      { label: 'Export JSON', action: () => {
        const json = JSON.stringify({ glyphscape: 1, presets: app.s.presets }, null, 2);
        download(new Blob([json], { type: 'application/json' }), 'glyphscape-presets.json');
      } },
      { label: 'Import JSON', action: () => this.importPresets() },
    ]));
    rows.push(heading('presets (number keys load 1 to 9)'));
    app.s.presets.forEach((p, i) => rows.push(this.presetRow(p, i)));
    if (!app.s.presets.length) rows.push(info(() => 'No presets yet. Save the current look to start a collection.', 'info dim'));
    rows.push(info(() => '⏎ load · R rename · Del delete', 'info dim'));
    return rows;
  }

  private presetRow(p: Preset, i: number): Row {
    const app = this.app;
    const el = h('div', 'row');
    el.tabIndex = 0;
    el.setAttribute('role', 'button');
    const text = h('span', '');
    const del = h('span', 'button inline', '[×]');
    el.append(text, del);
    const remove = () => {
      if (this.confirmDelete !== i) {
        this.confirmDelete = i;
        row.update();
        return;
      }
      this.confirmDelete = -1;
      app.store.update((s) => s.presets.splice(i, 1));
      this.rebuild();
    };
    const row: Row = {
      el,
      focusable: true,
      update: () => {
        const def = sceneById(p.scene);
        const style = p.style === 'auto' ? 'Auto' : styleById(p.style).name;
        const key = i < 9 ? String(i + 1) : ' ';
        const confirmTxt = this.confirmDelete === i ? '  press Del again to delete' : '';
        text.textContent = `${key}  ${p.name.slice(0, 26).padEnd(26)} ${def?.name ?? p.scene} · ${style}${confirmTxt}`;
      },
      activate: () => app.applyPreset(p),
      key: (e) => {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          remove();
          return true;
        }
        if (e.key === 'r' || e.key === 'R') {
          const name = prompt('Rename preset', p.name);
          if (name) {
            app.store.update(() => (p.name = name));
            row.update();
          }
          return true;
        }
        return false;
      },
    };
    el.addEventListener('click', (ev) => (ev.target === del ? remove() : app.applyPreset(p)));
    return row;
  }

  private importPresets() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const list: Preset[] = Array.isArray(data) ? data : data.presets;
        const valid = list.filter((p) => p && typeof p.scene === 'string' && sceneById(p.scene) && typeof p.name === 'string');
        this.app.store.update((s) => {
          for (const p of valid) {
            const base: Preset = { id: '', name: '', scene: p.scene, colorMode: 'style', glyphSet: 'style', palette: null, params: {}, style: 'auto', seed: 1 };
            s.presets.push({ ...Object.assign(base, p), id: `p-${Math.random().toString(36).slice(2, 8)}` });
          }
        });
        this.app.toast(`Imported ${valid.length} preset${valid.length === 1 ? '' : 's'}`);
        this.rebuild();
      } catch {
        this.app.toast('That file is not a Glyphscape preset export');
      }
    });
    input.click();
  }

  openTerminalFromConsole() {
    this.openTerminal();
  }
}
