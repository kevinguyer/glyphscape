import type { App } from './app';

/**
 * Rotates through scenes (all, favorites) or presets on a timer. Shuffle avoids immediate
 * repeats and weights toward favorites.
 */
export class Playlist {
  remaining: number;
  private history: string[] = [];
  private seqIndex = -1;

  constructor(private app: App) {
    this.remaining = app.s.playlist.interval;
    app.onSceneSet = () => this.reset();
    setInterval(() => this.tick(1), 1000);
  }

  private tick(dt: number) {
    const p = this.app.s.playlist;
    if (!p.enabled || document.visibilityState !== 'visible' || this.app.engine.frozen) return;
    this.remaining -= dt;
    if (this.remaining <= 0) this.next();
  }

  reset() {
    this.remaining = this.app.s.playlist.interval;
  }

  next() {
    this.reset();
    const p = this.app.s.playlist;
    const current = this.app.engine.activeDef.id;
    if (p.source === 'presets' && this.app.s.presets.length > 0) {
      const presets = this.app.s.presets;
      let i: number;
      if (p.order === 'sequential' || presets.length < 3) {
        i = (this.seqIndex + 1) % presets.length;
      } else {
        do i = Math.floor(Math.random() * presets.length);
        while (i === this.seqIndex);
      }
      this.seqIndex = i;
      this.app.applyPreset(presets[i], true);
      return;
    }
    const all = this.app.scenes().filter((d) => !d.hidden).map((d) => d.id);
    let pool = all;
    if (p.source === 'favorites') {
      const fav = p.favorites.filter((id) => all.includes(id));
      if (fav.length >= 2) pool = fav;
    }
    let id: string;
    if (p.order === 'sequential') {
      const i = pool.indexOf(current);
      id = pool[(i + 1) % pool.length];
    } else {
      const recent = new Set([current, ...this.history.slice(-Math.min(3, pool.length - 2))]);
      const candidates = pool.filter((s) => !recent.has(s));
      const list = candidates.length ? candidates : pool.filter((s) => s !== current);
      const weights = list.map((s) => (p.source === 'scenes' && p.favorites.includes(s) ? 2.5 : 1));
      let r = Math.random() * weights.reduce((a, b) => a + b, 0);
      id = list[0];
      for (let i = 0; i < list.length; i++) {
        r -= weights[i];
        if (r <= 0) {
          id = list[i];
          break;
        }
      }
    }
    this.history.push(current);
    if (this.history.length > 8) this.history.shift();
    this.app.setScene(id);
  }
}
