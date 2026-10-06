import type { GlyphSetId } from './engine/glyphs';
import type { TransitionType } from './engine/compositor';
import type { DitherMode, Palette } from './engine/styles';
import type { ColorMode } from './engine/types';

export interface Preset {
  id: string;
  name: string;
  scene: string;
  style: string;
  colorMode: ColorMode | 'style';
  glyphSet: GlyphSetId | 'style';
  palette: Partial<Palette> | null;
  seed: number;
  params: Record<string, number>;
  cellSize?: number;
}

export interface Settings {
  version: number;
  firstRunDone: boolean;
  scene: string;
  /** 'auto' follows each scene's recommended style. */
  style: string;
  colorMode: ColorMode | 'style';
  glyphSet: GlyphSetId | 'style';
  dither: DitherMode | 'style';
  palette: Partial<Palette> | null;
  effects: number;
  sceneGlyphs: boolean;
  brightness: number;
  contrast: number;
  cellSize: number;
  sceneParams: Record<string, Record<string, number>>;
  seeds: Record<string, number>;
  playlist: {
    enabled: boolean;
    interval: number; // seconds
    order: 'sequential' | 'shuffle';
    transition: TransitionType;
    transitionSecs: number;
    source: 'scenes' | 'favorites' | 'presets';
    favorites: string[];
  };
  audio: {
    enabled: boolean;
    source: 'mic' | 'tab';
    sensitivity: number;
    smoothing: number;
  };
  display: {
    frameCap: 15 | 30 | 60 | 0;
    nightMode: boolean;
    wakeLock: boolean;
    drift: boolean;
    breathing: boolean;
    autoDimHours: number; // 0 = off
    batterySaver: boolean;
    followClock: boolean;
    ghostClock: boolean;
    rareEvents: boolean;
  };
  console: {
    hotkey: string;
    autoHideSecs: number; // 0 = never
  };
  presets: Preset[];
  secretUnlocked: boolean;
}

export const DEFAULT_PRESETS: Preset[] = [
  { id: 'p-evening', name: 'Evening Mix opener', scene: 'aurora', style: 'borealis', colorMode: 'style', glyphSet: 'style', palette: null, seed: 8213, params: {} },
  { id: 'p-hearth', name: 'Ember room', scene: 'hearth', style: 'firelight', colorMode: 'style', glyphSet: 'style', palette: null, seed: 4410, params: {} },
  { id: 'p-currents', name: 'Phosphor currents', scene: 'flowfield', style: 'green-phosphor', colorMode: 'style', glyphSet: 'style', palette: null, seed: 1977, params: {} },
  { id: 'p-paper', name: 'Paper rain', scene: 'rain', style: 'paper-ink', colorMode: 'style', glyphSet: 'style', palette: null, seed: 2024, params: {} },
  { id: 'p-fusion', name: 'Fusion watch', scene: 'tokamak', style: 'vapor', colorMode: 'native', glyphSet: 'style', palette: null, seed: 3141, params: {} },
];

export function defaultSettings(): Settings {
  return {
    version: 1,
    firstRunDone: false,
    scene: 'aurora',
    style: 'auto',
    colorMode: 'style',
    glyphSet: 'style',
    dither: 'style',
    palette: null,
    effects: 1,
    sceneGlyphs: true,
    brightness: 1,
    contrast: 1,
    cellSize: 16,
    sceneParams: {},
    seeds: {},
    playlist: {
      enabled: true,
      interval: 600,
      order: 'shuffle',
      transition: 'dissolve',
      transitionSecs: 4,
      source: 'scenes',
      favorites: ['aurora', 'hearth', 'tokamak'],
    },
    audio: { enabled: false, source: 'mic', sensitivity: 1, smoothing: 0.6 },
    display: {
      frameCap: 60,
      nightMode: false,
      wakeLock: true,
      drift: true,
      breathing: true,
      autoDimHours: 0,
      batterySaver: true,
      followClock: false,
      ghostClock: true,
      rareEvents: true,
    },
    console: { hotkey: '`', autoHideSecs: 10 },
    presets: DEFAULT_PRESETS.map((p) => ({ ...p })),
    secretUnlocked: false,
  };
}

const KEY = 'glyphscape.settings.v1';

function merge<T>(base: T, over: unknown): T {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return (over ?? base) as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[k];
    out[k] = b && typeof b === 'object' && !Array.isArray(b) && v && typeof v === 'object' && !Array.isArray(v)
      && !['sceneParams', 'seeds', 'palette'].includes(k)
      ? merge(b, v)
      : v;
  }
  return out as T;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return merge(defaultSettings(), JSON.parse(raw));
  } catch {
    /* storage unavailable or corrupt: fall back to defaults */
  }
  return defaultSettings();
}

type Listener = (s: Settings) => void;

/** Tiny observable settings store with debounced persistence. */
export class Store {
  s: Settings;
  private listeners = new Set<Listener>();
  private saveTimer = 0;

  constructor() {
    this.s = loadSettings();
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Mutate settings in place, then notify and persist. */
  update(fn: (s: Settings) => void) {
    fn(this.s);
    this.listeners.forEach((l) => l(this.s));
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.save(), 400);
  }

  save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.s));
    } catch {
      /* quota or privacy mode: settings just won't persist */
    }
  }

  reset() {
    this.s = defaultSettings();
    this.s.firstRunDone = true;
    this.update(() => {});
  }
}
