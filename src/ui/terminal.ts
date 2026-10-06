import type { Ambient } from '../ambient';
import type { App } from '../app';
import { GLYPH_SETS } from '../engine/glyphs';
import { COLOR_MODES, STYLES } from '../engine/styles';
import type { Playlist } from '../playlist';
import { sceneById } from '../scenes';
import { h } from './controls';
import type { Overlays } from './overlays';

const HELP = [
  'scene <name|next|prev|random>   style <name|auto|next|prev>',
  'seed <n> · reroll · param <key> <value> · cell <px>',
  'color <mono|duotone|gradient|native|style> · glyphs <set> · dither <mode>',
  'bright <0.2-1.5> · contrast <0.5-2.5> · effects <0-1.5>',
  'cycle <on|off|next> · interval <minutes> · transition <dissolve|crossfade|wipe> [secs]',
  'preset <save name|load n|list> · audio <on|off|mic|tab> · night <on|off>',
  'fps <15|30|60|0> · fullscreen · postcard · photo [png|txt] · clock · event',
  'list scenes|styles · stats · clear',
];

/** The hidden terminal prompt: type commands like `scene aurora`, `style amber`, `seed 8213`. */
export class Terminal {
  root = h('div', 'terminal');
  private out = h('pre', 'term-out');
  private input = h('input', 'term-input');
  private history: string[] = [];
  private hIndex = -1;
  private outTimer = 0;
  isOpen = false;

  constructor(private app: App, private ambient: Ambient, private playlist: Playlist, private overlays: Overlays) {
    const line = h('div', 'term-line');
    line.append(h('span', 'prompt', '> '), this.input);
    this.root.append(this.out, line);
    this.root.hidden = true;
    this.input.setAttribute('aria-label', 'Command');
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.addEventListener('keydown', (e) => this.onKey(e));
    this.input.addEventListener('blur', () => window.setTimeout(() => {
      if (document.activeElement !== this.input) this.close();
    }, 100));
    document.body.append(this.root);
  }

  open() {
    this.isOpen = true;
    this.root.hidden = false;
    this.input.value = '';
    this.input.focus();
  }

  close() {
    this.isOpen = false;
    this.root.hidden = true;
    this.input.blur();
  }

  private print(lines: string | string[]) {
    this.out.textContent = Array.isArray(lines) ? lines.join('\n') : lines;
    this.out.classList.add('show');
    clearTimeout(this.outTimer);
    this.outTimer = window.setTimeout(() => this.out.classList.remove('show'), 7000);
  }

  private onKey(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Escape') {
      this.close();
      return;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (!this.history.length) return;
      this.hIndex = Math.max(-1, Math.min(this.history.length - 1, this.hIndex + (e.key === 'ArrowUp' ? 1 : -1)));
      this.input.value = this.hIndex >= 0 ? this.history[this.history.length - 1 - this.hIndex] : '';
      return;
    }
    if (e.key === 'Enter') {
      const cmd = this.input.value.trim();
      this.input.value = '';
      this.hIndex = -1;
      if (!cmd) return this.close();
      this.history.push(cmd);
      if (this.history.length > 50) this.history.shift();
      try {
        this.print(this.run(cmd));
      } catch (err) {
        this.print(`error: ${(err as Error).message}`);
      }
    }
  }

  /** Execute a command and return the response text. Exposed for testing. */
  run(cmd: string): string | string[] {
    const app = this.app;
    const [verb, ...rest] = cmd.split(/\s+/);
    const arg = rest.join(' ').toLowerCase();
    const num = parseFloat(rest[0]);
    const onOff = (v: string) => (v === 'on' || v === 'true' || v === '1' ? true : v === 'off' || v === 'false' || v === '0' ? false : null);
    switch (verb.toLowerCase()) {
      case 'help':
      case '?':
        return HELP;
      case 'clear':
        return '';
      case 'scene': {
        if (arg === 'next' || arg === '') { app.stepScene(1); return `scene ${app.engine.activeDef.name}`; }
        if (arg === 'prev') { app.stepScene(-1); return `scene ${app.engine.activeDef.name}`; }
        if (arg === 'random' || arg === 'shuffle') { app.shuffleScene(); return `scene ${app.engine.activeDef.name}`; }
        const def = app.scenes().find((d) => d.id === arg || d.name.toLowerCase().startsWith(arg) || d.id.startsWith(arg.replace(/\s/g, '')));
        if (!def) return `no scene "${arg}". try: list scenes`;
        app.setScene(def.id);
        return `scene ${def.name}`;
      }
      case 'style': {
        if (arg === 'next') { app.stepStyle(1); return `style ${app.styleLabel()}`; }
        if (arg === 'prev') { app.stepStyle(-1); return `style ${app.styleLabel()}`; }
        if (arg === 'auto') { app.setStyle('auto'); return 'style auto'; }
        const st = STYLES.find((s) => s.id === arg || s.id.startsWith(arg) || s.name.toLowerCase().includes(arg));
        if (!st) return `no style "${arg}". try: list styles`;
        app.setStyle(st.id);
        return `style ${st.name}`;
      }
      case 'seed':
        if (!Number.isFinite(num)) return `seed ${app.engine.activeRunner.seed}`;
        app.setSeed(num);
        return `seed ${Math.floor(num)}`;
      case 'reroll':
        app.reroll();
        return 'rerolled';
      case 'param':
      case 'set': {
        const key = rest[0];
        const val = parseFloat(rest[1]);
        const p = app.engine.activeDef.params.find((x) => x.key.toLowerCase() === key?.toLowerCase() || x.label.toLowerCase() === key?.toLowerCase());
        if (!p) return `params: ${app.engine.activeDef.params.map((x) => `${x.key} (${x.min}-${x.max})`).join(', ')}`;
        if (!Number.isFinite(val)) return `${p.key} = ${app.engine.activeRunner.ctx.params[p.key]}`;
        app.setParam(p.key, Math.max(p.min, Math.min(p.max, val)));
        return `${p.key} = ${app.engine.activeRunner.ctx.params[p.key]}`;
      }
      case 'speed':
        return this.run(`param speed ${rest[0] ?? ''}`);
      case 'cell':
        if (!Number.isFinite(num)) return `cell ${app.s.cellSize}px`;
        app.setCellSize(num);
        return `cell ${app.s.cellSize}px`;
      case 'color': {
        const m = COLOR_MODES.find((c) => c.id === arg || c.name.toLowerCase().startsWith(arg));
        const v = arg === 'style' || arg === 'default' ? 'style' : m?.id;
        if (!v) return 'color mono|duotone|gradient|native|style';
        app.store.update((s) => (s.colorMode = v));
        return `color ${v}`;
      }
      case 'glyphs': {
        const v = arg === 'style' ? 'style' : (Object.keys(GLYPH_SETS) as (keyof typeof GLYPH_SETS)[]).find((k) => k.startsWith(arg));
        if (!v) return `glyphs ${Object.keys(GLYPH_SETS).join('|')}|style`;
        app.store.update((s) => (s.glyphSet = v));
        return `glyphs ${v}`;
      }
      case 'dither': {
        const v = (['none', 'ordered', 'blue', 'style'] as const).find((k) => k.startsWith(arg));
        if (!v) return 'dither none|ordered|blue|style';
        app.store.update((s) => (s.dither = v));
        return `dither ${v}`;
      }
      case 'bright':
      case 'brightness':
        if (Number.isFinite(num)) app.store.update((s) => (s.brightness = Math.max(0.2, Math.min(1.5, num))));
        return `brightness ${app.s.brightness.toFixed(2)}`;
      case 'contrast':
        if (Number.isFinite(num)) app.store.update((s) => (s.contrast = Math.max(0.5, Math.min(2.5, num))));
        return `contrast ${app.s.contrast.toFixed(2)}`;
      case 'effects':
        if (Number.isFinite(num)) app.store.update((s) => (s.effects = Math.max(0, Math.min(1.5, num))));
        return `effects ${app.s.effects.toFixed(2)}`;
      case 'cycle': {
        if (arg === 'next') { this.playlist.next(); return 'next'; }
        const v = onOff(arg);
        if (v !== null) { app.store.update((s) => (s.playlist.enabled = v)); this.playlist.reset(); }
        return `cycle ${app.s.playlist.enabled ? 'on' : 'off'}`;
      }
      case 'interval':
        if (Number.isFinite(num)) {
          app.store.update((s) => (s.playlist.interval = Math.max(30, Math.min(7200, num * 60))));
          this.playlist.reset();
        }
        return `interval ${(app.s.playlist.interval / 60).toFixed(1)} min`;
      case 'transition': {
        const t = (['dissolve', 'crossfade', 'wipe'] as const).find((k) => k.startsWith(rest[0] ?? '-'));
        if (t) app.store.update((s) => (s.playlist.transition = t));
        const secs = parseFloat(rest[1]);
        if (Number.isFinite(secs)) app.store.update((s) => (s.playlist.transitionSecs = Math.max(0.5, Math.min(12, secs))));
        return `transition ${app.s.playlist.transition} ${app.s.playlist.transitionSecs}s`;
      }
      case 'preset': {
        const sub = rest[0]?.toLowerCase();
        if (sub === 'save') { const p = app.savePreset(rest.slice(1).join(' ')); return `saved ${p.name}`; }
        if (sub === 'load') {
          const p = app.s.presets[Math.floor(parseFloat(rest[1])) - 1] ?? app.s.presets.find((x) => x.name.toLowerCase().includes(rest.slice(1).join(' ').toLowerCase()));
          if (!p) return 'no such preset';
          app.applyPreset(p);
          return `loaded ${p.name}`;
        }
        return app.s.presets.map((p, i) => `${i + 1}. ${p.name}`);
      }
      case 'audio': {
        const a = app.engine.audio;
        if (arg === 'mic' || arg === 'tab') {
          app.store.update((s) => { s.audio.source = arg; s.audio.enabled = true; });
          a.start(arg);
          return `audio ${arg}`;
        }
        const v = onOff(arg);
        if (v === true) { app.store.update((s) => (s.audio.enabled = true)); a.start(app.s.audio.source); }
        if (v === false) { app.store.update((s) => (s.audio.enabled = false)); a.stop(); }
        return `audio ${app.s.audio.enabled ? a.status : 'off'}`;
      }
      case 'night': {
        const v = onOff(arg);
        app.store.update((s) => (s.display.nightMode = v ?? !s.display.nightMode));
        return `night ${app.s.display.nightMode ? 'on' : 'off'}`;
      }
      case 'fps': {
        if ([15, 30, 60, 0].includes(num)) app.store.update((s) => (s.display.frameCap = num as 15 | 30 | 60 | 0));
        return `frame cap ${app.s.display.frameCap || 'uncapped'}`;
      }
      case 'fullscreen':
        this.ambient.toggleFullscreen();
        return 'fullscreen';
      case 'postcard':
        this.close();
        app.postcard();
        return '';
      case 'photo':
        app.photo(arg === 'txt' || arg === 'text' ? 'txt' : 'png');
        return 'photo';
      case 'clock':
        app.engine.triggerClock();
        return 'ghost clock';
      case 'event':
        app.engine.triggerEvent();
        return 'rare event';
      case 'list':
        if (arg.startsWith('style')) return ['auto', ...STYLES.map((s) => s.id)].join('  ');
        return app.scenes().map((d) => d.id).join('  ');
      case 'stats':
        return this.overlays.toggleStats() ? 'stats on' : 'stats off';
      case 'probe':
      case 'vonneumann':
        return sceneById('probe') && app.s.secretUnlocked ? (app.setScene('probe'), 'scene Von Neumann') : 'unknown command. try help';
      default:
        return `unknown command "${verb}". try help`;
    }
  }
}
