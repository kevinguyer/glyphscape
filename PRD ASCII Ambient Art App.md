# PRD: ASCII Ambient Art App

Oct 5, 2026 · @Kevin Guyer

## Overview

**Working title:** Glyphscape (placeholder).

Glyphscape is a hosted web app that turns a spare monitor into living art made entirely of text characters. It runs fullscreen, shows no interface until summoned, and plays generative ASCII scenes that drift, evolve, and react to music.

The pitch: a fireplace, an aurora, a rainstorm, and a tokamak plasma torus, all rendered in glyphs, running quietly for hours on a second screen.

**Primary user:** a technologist or hobbyist with a spare display who wants a beautiful, low-attention background. **Initial user count:** one (the author), with an eye toward sharing.

## Goals, non-goals, success criteria

V1 succeeds if the author leaves it running on a second monitor for an evening and never gets bored or annoyed.

**Goals**

- Beautiful by default: the first scene on first launch should earn a screenshot.
- Zero-chrome ambient mode, with a hotkey console for all control.
- A scene x style matrix, so a handful of scenes yields dozens of looks.
- Both generative scenes and hand-authored frame animations.
- Audio-reactive mode in V1.
- Safe to leave on for hours: smooth, low CPU/GPU, no memory growth.

**Non-goals for V1**

- Shareable theme links and URL-encoded settings (post-V1).
- Accounts, cloud sync, or any backend.
- Mobile layouts.
- Global OS hotkeys or native kiosk wrappers.
- Image or video to ASCII conversion of user media.

**Success criteria**

- Holds 60 fps at 1080p and 30+ fps at 4K on a mid-range laptop GPU.
- First-run to first beautiful frame in under 3 seconds.
- 8 hour soak test: no visible stutter, memory growth under 10%.
- Console reachable and dismissible with one keypress, in every scene.
- At least 8 scenes and 5 styles shipped, producing 40+ distinct looks.

## Experience principles and core concepts

The app has one job: look good with no attention. Every decision bends toward that.

**Principles**

1. **Art first, UI second.** Ambient mode shows nothing but the scene.
2. **Slow is a feature.** Motion should breathe. Nothing flashes, nothing jumps.
3. **Monochrome by default.** Color is a deliberate choice, not the baseline.
4. **Everything is a knob, nothing is required.** Defaults are good enough to never open the console again.
5. **Delight in the details.** Rare easter eggs reward people who leave it running.

**Core concepts**

| Concept | Definition | Example |
| --- | --- | --- |
| Scene | A render loop plus a motion model that produces an intensity and color field | Aurora, Rain, Plasma |
| Style | A look applied over any scene: glyph set, palette, contrast, post effects | Amber CRT, Paper Ink |
| Palette | The color mapping for a style, monochrome by default | Green phosphor, Ice blue |
| Glyph set | The ordered characters used to map brightness to a symbol | Classic ramp, Braille, Blocks |
| Preset | A saved scene + style + parameter combination | Evening Mix opener |
| Playlist | An ordered or shuffled list of presets with durations | 3 hour wind-down |
| Seed | A number that makes a generative scene reproducible | Seed 8213 |

## Rendering engine

The engine draws a character grid to a canvas, never to DOM text, so a 4K monitor stays smooth.

**Requirements**

- **Grid renderer:** pre-rasterize each glyph once into a texture atlas, then draw cells as instanced quads (WebGL2 or WebGPU where available), with a Canvas 2D fallback.
- **Cell sizing:** the grid fills the viewport. Cell size is user adjustable (small cells give fine detail, large cells give chunky retro art). Recompute on resize and fullscreen changes.
- **Per cell data:** glyph index, foreground color, optional background color, and brightness.
- **Monospace font:** ship one or two bundled monospace fonts so rendering is identical on every machine. Braille and block-element coverage is required.
- **Fixed timestep simulation:** simulation updates at a fixed rate, rendering interpolates, and a frame cap option (15, 30, 60, uncapped) saves power.
- **Brightness to glyph ramps:** scenes output a float field. A style maps it through a ramp, optionally with dithering (ordered or blue noise) for smoother gradients.
- **Post effects (cheap, shader based):** phosphor glow and persistence, subtle scanlines, slight curvature, chromatic fringe. All off in the Clean style.
- **Deterministic RNG:** every scene takes a seed and uses a seeded generator, so a look can be recalled.

**Performance budgets**

| Target | Budget |
| --- | --- |
| 1080p, 60 fps | Under 6 ms per frame on a mid-range laptop GPU |
| 4K, 30+ fps | Under 16 ms per frame |
| Idle CPU (console closed) | Under 10% of one core |
| Memory growth over 8 hours | Under 10% |

## V1 scene library

V1 ships 10 scenes across five families, mixing procedural generation with hand-authored animation. Each scene exposes 2 to 4 tunable parameters (speed, density, scale, turbulence) plus a seed.

| Scene | Family | What you see | Audio reaction |
| --- | --- | --- | --- |
| Aurora | Procedural | Layered curtains of light rippling across a starfield | Bass widens curtains, highs add shimmer |
| Flow Field | Procedural | Thousands of glyph particles tracing evolving noise currents | Energy bends the field |
| Plasma | Procedural | Classic sine-interference plasma in glyph ramps | Beat shifts phase |
| Rain on Glass | Particle | Rain, droplets that merge and run, soft streetlight blur | Beats trigger gusts |
| Starfield Drift | Particle | Slow parallax flight through stars and the occasional nebula | Bass sets velocity |
| Embers | Particle | Rising sparks above a banked fire | Volume sets ember rate |
| Life Garden | Simulation | Conway-style cellular automata with age-based glyphs and gentle reseeding | Beats seed new life |
| Tokamak | Scenic | A rotating plasma torus with magnetic field lines, instabilities, and occasional disruptions | Mid frequencies drive turbulence |
| Night City | Scenic | Skyline with flickering windows, passing traffic, weather | Highs flicker windows |
| Hearth | Hand-authored | A looping frame-by-frame fireplace with generative flicker layered on top | Beats pulse the flame |

**Hand-authored scenes** use a simple frame format (an array of text frames plus per-frame timing and optional per-cell color layers). Hearth is the V1 proof. A few small authored loops (a lighthouse, a campfire, a cat on a windowsill) can follow if time allows.

**Scene quality bar:** every scene must look good at three cell sizes, loop or evolve for at least an hour without visible repetition, and degrade gracefully when the frame cap is lowered.

## Styles and color modes

Monochrome is the default. Color is a per-session choice in the console, and each scene may declare a recommended style when monochrome would not make sense (for example, Aurora defaults to a green-to-violet gradient).

| Style | Glyphs | Palette | Post effects |
| --- | --- | --- | --- |
| Clean Mono | Classic ramp | White on black | None |
| Green Phosphor | Classic ramp | Green on black | Glow, persistence |
| Amber CRT | Classic ramp | Amber on black | Glow, scanlines, curvature |
| Paper Ink | Dense ramp | Black on warm white | Slight grain |
| Braille Fine | Braille dots | Ice blue on black | Soft glow |
| Blocks | Block elements | Per scene gradient | None |
| Vapor | Classic ramp | Magenta to cyan gradient | Glow, chromatic fringe |

**Color modes (per session):** Monochrome, Duotone, Gradient, and Scene Native (the scene's own colors). Custom palettes can be edited in the console with a simple picker and saved as part of a preset.

**Contrast and brightness controls** are first class, since a spare monitor in a dim room needs different settings than one in daylight. A night mode caps peak brightness and shifts toward warmer tones.

## Console

The console is a translucent overlay, itself styled in ASCII, that opens on a hotkey and floats over the live scene so every change previews instantly.

**Behavior**

- **First launch:** the console is open by default, with a short welcome and the hotkey shown. After that it starts hidden and the art runs immediately.
- **Hotkey:** backtick toggles the console. Esc closes it. The hotkey is remappable. A small hint fades in for a few seconds on startup if the console is hidden.
- **Auto-hide:** after 10 seconds of inactivity (configurable, can be disabled) the console fades out and the cursor hides.
- **Click through:** while the console is open, the scene keeps running behind it. Changes apply live, no Apply button.
- **Keyboard first:** every control is reachable by keyboard. Arrow keys switch scenes and styles, with number keys for presets.

**Panels**

| Panel | Controls |
| --- | --- |
| Scene | Browse scenes with live thumbnails, pick one, shuffle |
| Style | Style, color mode, palette editor, glyph set, brightness, contrast |
| Motion | Speed, density, cell size, scale, scene specific parameters, seed (with a reroll button) |
| Playlist | Cycle on or off, interval, order (sequential or shuffle), transition type, favorites |
| Audio | Reactive on or off, input source, sensitivity, smoothing, a live level meter |
| Display | Fullscreen, frame cap, night mode, wake lock, burn-in care options |
| Presets | Save, rename, delete, export or import as JSON |

**Persistence:** all settings and presets save to localStorage and restore on the next launch. Shareable URL links are post-V1.

## Ambient behavior

This section covers everything that makes the app safe and pleasant to leave on all night.

**Cycling and transitions**

- Cycle mode rotates through the playlist on a timer (default 10 minutes, range 30 seconds to 2 hours) or stays on one scene.
- Transitions are slow by default (about 4 seconds). Types: crossfade, glyph dissolve (cells swap to the next scene's characters in a noise pattern), and wipe. Never a hard cut.
- Shuffle avoids immediate repeats and weights toward favorites.

**Display care**

- **Burn-in protection:** very slow global pixel drift (a few pixels per minute), periodic subtle brightness breathing, and optional automatic dimming after long static periods.
- **Wake lock:** request the Screen Wake Lock API so the display does not sleep. Show a clear indicator if the browser denies it.
- **Fullscreen:** one key (F) toggles the Fullscreen API. The cursor hides after 3 seconds of no movement.
- **Power:** optional frame cap, plus pause or reduce to 15 fps when the tab is hidden or the device is on battery (where detectable).
- **Resilience:** recover cleanly from resize, monitor change, tab suspend, and WebGL context loss.

**Time of day (optional setting):** scenes can follow the clock. Warm, dim styles at night. Brighter at midday. Off by default.

## Audio reactivity

Audio reactivity is in V1, off by default, and always opt in. Scenes feel alive when the room has music in it.

**Inputs**

- **Microphone:** works with any music playing in the room, requires a browser permission prompt.
- **Tab or system audio capture:** via getDisplayMedia where the browser supports it, for a cleaner signal from a music player tab.

**Analysis pipeline**

1. Web Audio AnalyserNode produces FFT data each frame.
2. Collapse into 4 bands: bass, low mid, high mid, treble.
3. Add overall loudness and a simple onset (beat) detector based on spectral flux.
4. Smooth with attack and release envelopes so motion stays gentle.
5. Expose a small `audio` object to scenes: `{bands[4], level, beat, beatPhase}`.

**Rules**

- Reactivity is a modulation of the scene, never a takeover. A silent room must still look great.
- A sensitivity slider and smoothing slider live in the Audio panel, with a live level meter.
- No audio is recorded, stored, or sent anywhere. State this in the console beside the permission request.
- If permission is denied or no signal is detected, fall back silently to normal motion and show a small status in the console.

## Surprise features

These are the delighters. Each is small, but together they make the app feel crafted. All are in V1 unless marked stretch.

| Feature | What it does |
| --- | --- |
| Glyph dissolve transitions | Scenes melt into each other character by character, following a noise mask, instead of fading |
| Ghost clock | Once an hour, the time briefly condenses out of the scene's own particles (rain forms the digits, then falls apart) |
| Rare events | Low probability moments, such as a shooting star, a lightning flash, a whale silhouette in the ocean, a lone figure crossing Night City. They happen about once an hour so the app rewards people who leave it on |
| Weather sync (stretch) | Optional, with a location prompt: Night City and Rain on Glass reflect the real local weather |
| Console as ASCII | The console is drawn with box characters and glyph sliders, and ships with a hidden terminal prompt for typing commands like `scene aurora`, `style amber`, `seed 8213` |
| Seed postcards | A key (P) freezes the moment and shows its scene, style, and seed in a corner for 5 seconds, so a favorite look can be recalled exactly |
| Konami code | Unlocks a secret scene (for example, a tiny ASCII Von Neumann probe drifting across the starfield) |
| Day and night drift | Optional slow color temperature shift across the day |
| Screensaver mode | Pressing any key or moving the mouse hides the cursor and keeps art running, instead of exiting like a native screensaver |
| Photo mode (stretch) | Saves the current frame as a PNG or as plain text for pasting anywhere |

**Rule for all surprises:** never interrupt the calm. If it would startle someone across the room, tone it down.

## Scene API and architecture

A scene is a self-contained module with a small contract, so adding one means writing one file. The engine owns the grid, timing, styling, audio, and transitions. Scenes only describe what each cell should look like.

&#91;embedded content: engine architecture · 9 components\]

A new scene plugs in at the left edge and inherits transitions, styling, audio, and rendering for free.

```js
export default {
  id: 'aurora',
  name: 'Aurora',
  family: 'procedural',
  recommendedStyle: 'gradient-violet',
  params: [
    { key: 'speed',   label: 'Speed',   min: 0.1, max: 3, default: 1 },
    { key: 'density', label: 'Density', min: 0,   max: 1, default: 0.6 }
  ],
  init(ctx)               { /* ctx: grid size, rng(seed), params */ },
  update(dt, audio, ctx)  { /* advance simulation */ },
  render(grid, ctx)       { /* write brightness, color, optional glyph per cell */ }
}
```

**Architecture principles**

- **Scenes never touch the DOM or canvas.** They write into a grid buffer, which makes transitions, previews, and thumbnails free.
- **Two scenes can run at once** during a transition, each into its own buffer, blended by the compositor.
- **Hand-authored scenes** use the same contract with a frame player helper.
- **Plain modules, no build-time magic:** scenes register themselves in a manifest so the console lists them automatically.
- **Suggested stack:** TypeScript, Vite, vanilla canvas or WebGL2 with a thin custom engine. No UI framework for the scene layer. The console may use a light framework or plain DOM.

## Non-functional requirements

| Area | Requirement |
| --- | --- |
| Hosting | Static site on any CDN. No backend, no accounts, no analytics in V1 |
| Browsers | Current Chrome, Edge, Firefox, and Safari. Chrome and Edge are the primary targets (wake lock, audio capture) |
| Rendering | WebGL2 required, WebGPU optional, Canvas 2D fallback with reduced effects |
| Performance | Budgets in the rendering section, verified by an 8 hour soak test |
| Privacy | All data stays in the browser. Audio is analyzed in memory and never stored or transmitted |
| Accessibility | Respect prefers-reduced-motion by slowing scenes and disabling flash events. Console is fully keyboard operable with visible focus and readable contrast |
| Safety | No flashing above 3 Hz. Rare events fade in and out gently |
| Offline | Installable as a PWA with all assets cached, so it still works without a connection |
| Loading | Interactive in under 3 seconds on a broadband connection, with a total payload under 2 MB |
| Licensing | Bundled fonts must be open licensed. No third party art assets in V1 |

## Scope, milestones, risks, and open questions

**V1 scope:** 10 scenes, 7 styles, the hotkey console, playlists and transitions, audio reactivity, ambient care features, local persistence, and the surprise features not marked stretch.

**Post-V1:** shareable theme links, more scenes and authored loops, user scene plugins loaded from a file or URL, weather sync, photo mode, a native wrapper with global hotkeys, multi-monitor awareness.

**Suggested build order**

1. Engine core: grid, glyph atlas, renderer, fixed timestep, one test scene.
2. Console shell, hotkey, settings persistence, fullscreen, auto-hide.
3. Style system and post effects.
4. Scene library, simplest to hardest (Plasma, Starfield, Rain, Embers, Flow Field, Aurora, Life Garden, Night City, Tokamak).
5. Hand-authored frame player and Hearth.
6. Transitions, playlists, presets.
7. Audio pipeline and per-scene reactions.
8. Surprise features, burn-in care, PWA, soak testing and polish.

**Risks**

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Scenes look cheap at large cell sizes | Core appeal suffers | Quality bar: review each scene at three cell sizes before shipping |
| 4K performance on weak GPUs | Stutter, heat | Texture atlas and instancing, frame cap, auto-reduce effects |
| Wake lock and audio capture inconsistent across browsers | Feature gaps | Detect and explain in console, document Chrome and Edge as primary |
| Tokamak and Night City scenes are complex | Schedule slip | Build them last, ship V1 with 8 scenes if needed |
| Backtick hotkey conflicts with some keyboard layouts | Console unreachable | Remappable hotkey, plus a visible hint and an alternate (H or ?) |
| Burn-in on OLED screens | Hardware harm | Drift, breathing, auto-dim, and a documented warning |

**Assumptions (flagged defaults)**

- Working title is a placeholder.
- Defaults chosen without explicit input: backtick hotkey, 10 minute cycle, 10 scenes, 7 styles.
- Single user, no telemetry.

**Open questions**

- [ ] Final name for the app?
- [ ] Is there a preferred monospace font, or should the PRD choose one?
- [ ] Should the hidden terminal prompt be in V1 or a stretch item?
- [ ] Any must-have scenes missing from the list (a space station, a bead game motif, a Von Neumann probe)?
- [ ] Is OLED burn-in a real concern for the target monitor?
