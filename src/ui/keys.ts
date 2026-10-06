import type { Ambient } from '../ambient';
import type { App } from '../app';
import type { Console } from './console';
import type { Terminal } from './terminal';

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];

/**
 * Global hotkeys. ` (remappable), H or ? toggle the console; Esc closes; arrows change scene
 * and style; 1-9 load presets; F fullscreen; P postcard; / opens the terminal.
 */
export function installKeys(app: App, ambient: Ambient, consoleUi: Console, terminal: Terminal) {
  let konami = 0;
  let konamiStyle = app.s.style;

  window.addEventListener('keydown', (e) => {
    app.engine.audio.resume();
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // Konami tracking runs alongside everything else. Arrows change scene and style while it's
    // being typed, so remember the style from before the sequence and restore it at the end.
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (k === KONAMI[konami]) {
      if (konami === 0) konamiStyle = app.s.style;
      konami++;
      if (konami === KONAMI.length) {
        konami = 0;
        app.setStyle(konamiStyle);
        app.unlockSecret();
        e.preventDefault();
        return;
      }
    } else {
      konami = k === KONAMI[0] ? 1 : 0;
      if (konami) konamiStyle = app.s.style;
    }

    // While rebinding the console key, every key goes to the console.
    if (consoleUi.capturing) {
      e.preventDefault();
      consoleUi.handleKey(e);
      return;
    }

    const hotkey = app.s.console.hotkey;
    if (e.key === hotkey || e.key === 'h' || e.key === 'H' || e.key === '?') {
      e.preventDefault();
      consoleUi.toggle();
      return;
    }
    if (e.key === 'Escape') {
      if (consoleUi.isOpen) consoleUi.close();
      return;
    }
    if (consoleUi.handleKey(e)) {
      e.preventDefault();
      return;
    }
    switch (e.key) {
      case '/':
      case ':':
        e.preventDefault();
        terminal.open();
        return;
      case 'f':
      case 'F':
        ambient.toggleFullscreen();
        return;
      case 'p':
      case 'P':
        app.postcard();
        return;
      case 'ArrowLeft':
      case 'ArrowRight':
        if (!consoleUi.isOpen) app.stepScene(e.key === 'ArrowLeft' ? -1 : 1);
        return;
      case 'ArrowUp':
      case 'ArrowDown':
        if (!consoleUi.isOpen) {
          e.preventDefault();
          app.stepStyle(e.key === 'ArrowUp' ? -1 : 1);
        }
        return;
    }
    if (/^[1-9]$/.test(e.key)) app.loadPresetIndex(Number(e.key) - 1);
  });
}
