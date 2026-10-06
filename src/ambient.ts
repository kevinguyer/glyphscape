import type { App } from './app';

export type WakeStatus = 'off' | 'active' | 'denied' | 'unsupported' | 'released';

/** Everything that makes it safe to leave on all night: wake lock, fullscreen, cursor hiding. */
export class Ambient {
  wake: WakeStatus = 'off';
  onChange: () => void = () => {};
  private sentinel: WakeLockSentinel | null = null;
  private cursorTimer = 0;
  consoleOpen = false;

  constructor(private app: App) {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.syncWakeLock();
    });
    document.addEventListener('fullscreenchange', () => this.onChange());
    const activity = () => {
      this.app.engine.lastInput = performance.now();
      this.showCursor();
    };
    window.addEventListener('pointermove', activity, { passive: true });
    window.addEventListener('pointerdown', activity, { passive: true });
    window.addEventListener('keydown', () => (this.app.engine.lastInput = performance.now()), { passive: true });
    this.showCursor();
    this.syncWakeLock();
    // Some browsers only grant wake locks after a user gesture: retry on the first one.
    const retry = () => {
      if (this.wake !== 'active') this.syncWakeLock();
    };
    window.addEventListener('pointerdown', retry, { once: true });
    window.addEventListener('keydown', retry, { once: true });
  }

  async syncWakeLock() {
    const want = this.app.s.display.wakeLock;
    if (!want) {
      await this.sentinel?.release().catch(() => {});
      this.sentinel = null;
      this.wake = 'off';
      this.onChange();
      return;
    }
    if (!('wakeLock' in navigator)) {
      this.wake = 'unsupported';
      this.onChange();
      return;
    }
    if (this.sentinel && !this.sentinel.released) return;
    if (document.visibilityState !== 'visible') return;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.wake = 'active';
      this.sentinel.addEventListener('release', () => {
        this.wake = 'released';
        this.onChange();
      });
    } catch {
      this.wake = 'denied';
    }
    this.onChange();
  }

  get fullscreen() {
    return !!document.fullscreenElement;
  }

  async toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch {
      this.app.toast('Fullscreen is not available here');
    }
  }

  /** Cursor shows on movement and hides after 3 s of stillness (unless the console is open). */
  showCursor() {
    document.body.classList.remove('no-cursor');
    clearTimeout(this.cursorTimer);
    this.cursorTimer = window.setTimeout(() => {
      if (!this.consoleOpen) document.body.classList.add('no-cursor');
    }, 3000);
  }
}
