# Glyphscape

Living ASCII art for a spare monitor. Glyphscape runs fullscreen in the browser, shows no UI until you ask for it, and plays generative and hand-authored text-mode scenes that drift, evolve, and (optionally) react to music.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/ (≈280 KB, deploy to any CDN)
npm test           # unit + scene determinism tests
npm run new-scene -- <id> "Name"   # scaffold and register a new scene
```

## Using it

On first launch the console opens with a short welcome. After that, the art starts immediately and a hint fades in for a few seconds.

| Key | Action |
| --- | --- |
| `` ` `` (remappable), `H`, `?` | Toggle the console |
| `Esc` | Close the console or terminal |
| `←` / `→` | Previous / next scene (console closed) |
| `↑` / `↓` | Previous / next style (console closed) |
| `1`–`9` | Load preset 1–9 |
| `F` | Fullscreen |
| `P` | Seed postcard: freezes the moment and shows scene, style and seed for 5 s |
| `/` or `:` | Hidden terminal prompt |
| ↑↑↓↓←→←→BA | You'll see |

**In the console:** `Tab` / `Shift+Tab` switch panels, `↑↓` move, `←→` adjust (hold `Shift` for big steps), `Enter` activates, `*` favorites a scene, `Del` deletes a preset, `R` renames one. Everything applies live and saves to `localStorage`. The console fades out after 10 s of inactivity (configurable).

**Terminal commands** (type `help`): `scene aurora`, `style amber`, `seed 8213`, `reroll`, `param speed 0.5`, `cell 12`, `color native`, `glyphs braille`, `dither blue`, `bright 0.8`, `contrast 1.4`, `cycle off`, `interval 15`, `transition wipe 6`, `preset save Late night`, `preset load 2`, `audio mic`, `night on`, `fps 30`, `postcard`, `photo png|txt`, `clock` (ghost clock now), `event` (rare event now), `list scenes`, `stats` (perf/heap HUD for soak tests).

## What's in V1

**16 scenes + 1 secret**, each with 2–4 parameters and a seed:

| Scene | Family | Rare event (~1/hour) | Audio |
| --- | --- | --- | --- |
| Aurora | procedural | shooting star | bass widens curtains, treble adds shimmer |
| Flow Field | procedural | a whale glides through the currents | energy bends the field |
| Plasma | procedural | a slow ring ripple | beats shift phase |
| Rain on Glass | particle | one soft lightning swell | beats trigger gusts |
| Storm | scenic | spider lightning crawls along the cloud base | bass drives gusts, beats spark in-cloud flashes |
| Moonlit Surf | scenic | a bioluminescent tide | bass raises the swell, beats sparkle the foam |
| Meteor Shower | particle | an outburst opened by a fireball | beats launch meteors |
| Glow Reef | scenic | a manta ray glides over, lighting up its wake | bass pulses jellyfish, beats spark plankton |
| Mycelium | simulation | a fruiting burst: mushrooms glow and release spores | beats send pulses through the network |
| Event Horizon | scenic | a hot spot orbits the inner disk, lensed on every pass | level brightens the disk |
| Starfield Drift | particle | shooting star | bass sets velocity |
| Embers | particle | the log settles: a burst of sparks | volume sets ember rate |
| Life Garden | simulation | a glider flotilla sails in | beats seed new life |
| Tokamak | scenic | disruption: quench, ejecta, re-formation | mids drive turbulence |
| Night City | scenic | a lone walker crosses the street | treble flickers windows |
| Hearth | hand-authored | the cat wakes up | beats pulse the flame |
| Von Neumann *(secret)* | secret | — | — |

**10 styles:** Clean Mono, Green Phosphor, Amber CRT, Paper Ink, Braille Fine, Blocks, Vapor, plus Borealis, Firelight and Midnight (used by Auto). **Auto** follows each scene's recommended look. Every style can be overridden per session: color mode (Monochrome, Duotone, Gradient, Scene Native), glyph set (classic, dense, braille, blocks), dithering (none, ordered, blue noise), palette colors, brightness, contrast, and effect strength. That is far more than the 40 distinct looks the PRD asks for.

**Ambient care:** playlist cycling (all scenes, favorites, or presets; sequential or shuffle with favorites weighting and no immediate repeats) with glyph-dissolve, crossfade or wipe transitions (never a hard cut); Screen Wake Lock with a visible status; slow pixel drift and brightness breathing for burn-in; optional auto-dim when idle; night mode and follow-the-clock warmth; frame caps (15/30/60/uncapped); 15 fps on battery; pauses in hidden tabs; recovers from resize, monitor/DPR changes, tab suspend and WebGL context loss (falls back to Canvas 2D if the GPU context never returns).

**Surprises:** ghost clock (the time condenses out of the scene once an hour and rains apart), rare events, glyph dissolve transitions, the ASCII console with glyph sliders, the hidden terminal, seed postcards, the Konami secret scene, photo mode (`photo png` / `photo txt`, a stretch item that came cheap).

**Audio** (off by default, opt-in): microphone or tab/system audio via `getDisplayMedia`. FFT → 4 bands, level, spectral-flux beat detection with tempo-estimated beat phase, attack/release smoothing, adaptive gain. Analysis happens in memory only; nothing is recorded, stored or sent. Denied permission or silence falls back to normal motion with a status line in the console.

**PWA:** `npm run build` emits a service worker that precaches every asset, so the installed app works offline.

## Architecture

```
scene.update()/render()  →  Grid (brightness, color, glyph hint per cell)
                         →  Compositor (style: ramp + dither, color mode, palette; transitions; ghost clock)
                         →  StyledFrame (glyph index, fg rgba, bg rgba per cell)
                         →  Renderer (WebGL2, or Canvas 2D fallback)
```

- **Scenes never touch the DOM or canvas.** They write a `Grid`. That makes transitions (two scenes at once), live console thumbnails, and photo mode free. A scene is one file in `src/scenes/` registered in `src/scenes/index.ts`. Shared building blocks (stars, meteors, rain, lightning) live in `src/scenes/kit/`. See **[src/scenes/README.md](src/scenes/README.md)** for the contract, house rules, and kit, or run `npm run new-scene`.
- **Fixed timestep, GPU interpolation.** Simulation ticks at up to 30 Hz (or the frame cap if lower). Each tick is styled once and uploaded as three small data textures; the GPU crossfades the previous and current tick's glyphs every frame, so 60 fps costs almost no CPU.
- **Renderer.** Glyphs are rasterized once into an atlas (braille, block elements, box drawing and a few shapes are drawn procedurally so they are pixel-identical everywhere). A fullscreen pass looks up each pixel's cell and glyph with `texelFetch`; this does the job of instanced quads with one draw call. Post passes add phosphor persistence (feedback buffer), bloom (quarter-res blur), scanlines, curvature, chromatic fringe, grain, vignette, and the display-care controls (brightness, warmth, peak cap, drift).
- **Hand-authored scenes** use `src/engine/frames.ts`: text frames with per-frame timing, an optional static base layer, and optional color layers. At native size the exact glyphs are drawn; when the grid is much larger, each authored character is re-rasterized into a block of cells so the art scales without turning into mush.
- **Determinism.** Every scene draws from a seeded RNG and seeded noise, so a seed recalls a look exactly (tested).

Debug: `?renderer=2d` forces the Canvas 2D fallback. `window.glyphscape` exposes the engine, store and app in the console.

## Decisions on the PRD's open questions

- **Name:** kept *Glyphscape*.
- **Font:** JetBrains Mono (OFL), bundled via `@fontsource`. Braille and block coverage comes from procedural drawing rather than the font.
- **Hidden terminal:** shipped in V1.
- **Extra scenes:** the Von Neumann probe is the Konami secret.
- **OLED:** drift and breathing are on by default; auto-dim is available; the Display panel carries a note.

## Not yet verified

- The 8-hour soak test and the 4K/mid-range GPU budgets need real hardware. Use `stats` in the terminal for an on-screen fps/tick/heap readout while soaking. Per-tick simulation cost was measured at 0.5–4 ms per scene on a 200×67 grid (1080p at 16 px cells).
- Audio reactivity, wake lock, and fullscreen were exercised for errors only; they need a real browser session with permissions (Chrome/Edge are the primary targets).
- Safari and Firefox haven't been tested.
