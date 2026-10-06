import type { Ambient } from '../ambient';
import type { App } from '../app';
import { h, setMono } from './controls';

/** Small, gentle overlays: startup hint, seed postcard, toasts, and an optional stats HUD. */
export class Overlays {
  private hintEl = h('div', 'overlay hint');
  private cardEl = h('div', 'overlay postcard');
  private toastEl = h('div', 'overlay toast');
  private statsEl = h('div', 'overlay stats');
  private toastTimer = 0;
  private cardTimer = 0;
  private statsTimer = 0;

  constructor(private app: App, private ambient: Ambient) {
    for (const el of [this.hintEl, this.cardEl, this.toastEl, this.statsEl]) {
      el.setAttribute('aria-live', 'polite');
      document.body.append(el);
    }
    app.onToast((m) => this.toast(m));
    app.onPostcard = () => this.postcard();
  }

  /** Fades in a reminder of the hotkey for a few seconds, plus any wake-lock problem. */
  hint() {
    const key = this.app.s.console.hotkey;
    window.setTimeout(() => {
      const wake = this.ambient.wake;
      const problem = wake === 'denied' || wake === 'unsupported' ? ' · wake lock unavailable, the display may sleep' : '';
      this.hintEl.textContent = `press ${key === '`' ? '` (backtick)' : key} or H for the console${problem}`;
      this.hintEl.classList.add('show');
      window.setTimeout(() => this.hintEl.classList.remove('show'), 4500);
    }, 900);
  }

  toast(msg: string) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), 2600);
  }

  /** Seed postcard: the scene, style and seed of this frozen moment, for five seconds. */
  postcard() {
    const e = this.app.engine;
    const lines = [
      ` ${e.activeDef.name} `,
      ` ${this.app.styleLabel()} `,
      ` seed ${e.activeRunner.seed} `,
      ` ${new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} `,
    ];
    const w = Math.max(...lines.map((l) => l.length)) + 2;
    const out = [`┌${'─'.repeat(w)}┐`, ...lines.map((l) => `│ ${l.padEnd(w - 2)} │`), `└${'─'.repeat(w)}┘`];
    setMono(this.cardEl, out.join('\n'));
    const st = e.activeStyle;
    this.cardEl.style.color = st.light ? '#2a2620' : `rgb(${st.fg.map((v) => Math.round(v * 255)).join(',')})`;
    this.cardEl.classList.add('show');
    clearTimeout(this.cardTimer);
    this.cardTimer = window.setTimeout(() => this.cardEl.classList.remove('show'), 5000);
  }

  toggleStats() {
    if (this.statsTimer) {
      clearInterval(this.statsTimer);
      this.statsTimer = 0;
      this.statsEl.classList.remove('show');
      return false;
    }
    const start = performance.now();
    const mem0 = heap();
    const upd = () => {
      const s = this.app.engine.stats;
      const mem = heap();
      const growth = mem0 && mem ? ` (${(((mem - mem0) / mem0) * 100).toFixed(1)}%)` : '';
      const up = (performance.now() - start) / 60000;
      this.statsEl.textContent = [
        `${s.renderer}  ${s.fps.toFixed(1)} fps`,
        `gpu submit ${s.frameMs.toFixed(2)} ms`,
        `sim tick   ${s.tickMs.toFixed(2)} ms`,
        `grid       ${s.cols}×${s.rows}`,
        mem ? `heap       ${(mem / 1048576).toFixed(1)} MB${growth}` : 'heap       n/a',
        `uptime     ${up.toFixed(1)} min`,
      ].join('\n');
    };
    upd();
    this.statsTimer = window.setInterval(upd, 1000);
    this.statsEl.classList.add('show');
    return true;
  }
}

function heap(): number {
  const m = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
  return m?.usedJSHeapSize ?? 0;
}
