import '@fontsource/jetbrains-mono/latin-400.css';
import '@fontsource/jetbrains-mono/latin-700.css';
import './style.css';
import { Ambient } from './ambient';
import { App } from './app';
import { Engine } from './engine/engine';
import { Playlist } from './playlist';
import { Store } from './settings';
import { Console } from './ui/console';
import { installKeys } from './ui/keys';
import { Overlays } from './ui/overlays';
import { Terminal } from './ui/terminal';

async function boot() {
  const host = document.getElementById('app')!;
  const store = new Store();
  // Wait briefly for the bundled font so the glyph atlas uses it; never block the first frame long.
  await Promise.race([
    document.fonts.load('16px "JetBrains Mono"'),
    new Promise((r) => setTimeout(r, 1200)),
  ]).catch(() => {});

  const engine = new Engine(host, store);
  engine.start();
  const app = new App(store, engine);
  const ambient = new Ambient(app);
  const playlist = new Playlist(app);
  const overlays = new Overlays(app, ambient);
  const terminal = new Terminal(app, ambient, playlist, overlays);
  const consoleUi = new Console(app, ambient, playlist, () => terminal.open());
  installKeys(app, ambient, consoleUi, terminal);

  // Audio was left on last time: try to resume (mic permission may persist; tab capture can't).
  if (store.s.audio.enabled) {
    if (store.s.audio.source === 'mic') engine.audio.start('mic');
    else store.update((s) => (s.audio.enabled = false));
  }

  // First launch opens the console with a welcome; afterwards the art runs immediately.
  if (!store.s.firstRunDone) consoleUi.open();
  else overlays.hint();

  // Clicking the art (outside the console) is a gentle way to toggle the console too.
  host.addEventListener('dblclick', () => consoleUi.toggle());

  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  (window as unknown as { glyphscape: unknown }).glyphscape = { engine, store, app, terminal, console: consoleUi };
}

boot();
