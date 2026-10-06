# Writing a scene

A scene is one file in this folder plus one line in [`index.ts`](index.ts). The fastest start:

```bash
npm run new-scene -- tide-pools "Tide Pools" scenic
```

That writes a working `tide-pools.ts` from a template and registers it. Run `npm run dev`, press `/`, and type `scene tide-pools`. The scene appears in the console, the playlist, and the test suite automatically.

## The contract

```ts
const myScene: SceneDef = {
  id, name, family, blurb,
  recommended: { style: 'midnight', colorMode?: 'native' }, // what "Auto" style uses
  defaultSeed: 1234,                                         // curated first look
  params: [{ key: 'speed', label: 'Speed', min, max, default, step? }],  // 2-4 is ideal
  create() {
    // all state lives in this closure
    return {
      init(ctx) {},                 // start, and again after every resize
      update(dt, audio, ctx) {},    // advance the simulation (fixed step, up to 30 Hz)
      render(grid, ctx) {},         // write every cell you want lit
      event(ctx) {},                // optional rare event, roughly once an hour
    };
  },
};
```

- **The grid** starts each tick cleared to black. Per cell: brightness `v` (0..1), a native color `col` (rgb 0..1, used by the Scene Native, Blocks, Firelight and Midnight looks), and an optional glyph hint (`glyph`, a code point). Helpers: `grid.set`, `grid.max` (keep the brighter), `grid.add` (additive light), `grid.splat` (sub-cell position), `grid.text` (authored text).
- **Glyph hints** are honored by the classic and dense ramps. Braille and Blocks ignore them and draw from brightness alone, so a scene must still read correctly from brightness.
- **Determinism:** use `ctx.rng` and `ctx.noise` only, never `Math.random`. The tests run every scene twice with the same seed and require identical output.
- **Aspect:** cells are about 0.6 as wide as they are tall. Multiply x distances by `ctx.aspect` to work in square units.
- **Thumbnails:** `ctx.thumbnail` is true for the tiny console previews (about 34×10). Skip extras like text labels there.

## Rules of the house

- **Slow is a feature.** Nothing should flash or jump. Any brightening of a large area must rise and fall smoothly, and repeat no faster than 3 Hz. Use `pulse()` from the kit, or `Lightning`, which already enforces this.
- **Respect `ctx.reducedMotion`:** soften flashes and slow things down (the engine already slows time by 40%).
- **Audio modulates, never takes over.** A silent room must look great. Fields: `audio.bands[0..3]` (bass, low mid, high mid, treble), `level`, `beat` (1 on an onset, decaying), `beatPhase`.
- **Faint haze** below about 15% brightness is drawn as sparse random specks. Keep backgrounds low (about 0.01–0.04) so the subject stands out.
- **Budget:** aim for under 2–3 ms per tick on a 200×67 grid (1080p at 16 px cells). Per-cell noise is the usual cost. Cache slow fields with `LowResField` / `LowResFieldN` (`src/engine/field.ts`), and use `fsin` / `fexp` from `src/engine/math.ts` in hot loops.
- **Check three cell sizes** (8, 16 and 28 px) and leave it running a few minutes before calling it done.

## The kit (`./kit`)

| Piece | What it gives you | Used by |
| --- | --- | --- |
| `StarField` | Twinkling stars with a realistic magnitude spread, optional sky rotation around a pole, occlusion, and an acceptance map (e.g. to trace the Milky Way) | Meteor Shower, Ocean |
| `Meteors` | Pooled shooting stars and fireballs with fading tails and lingering, wind-bent trains | Meteor Shower, Aurora, Starfield |
| `Motes` | Drifting glowing particles on a noise current that flare when excited (`excite`) or emitted (`emit`), with a configurable fade | Glow Reef (plankton), Mycelium (spores) |
| `RainStreaks` | Thousands of slanted rain streaks, optionally lit by lightning | Storm |
| `Lightning` | Branching ground strikes, spider lightning, in-cloud sheet flashes, a `light(x, y)` falloff for lighting clouds and ground, all with a safe envelope | Storm |
| `lineGlyph(dx, dy, aspect)` | The `- | / \` that best follows a direction | Meteors, Lightning, Rain |
| `fireColor(t)` | Blackbody ramp, dark red to white | Embers, Hearth |
| `pulse(age, rise, decay)` | A smooth one-shot envelope | Lightning |
| `cp('x')` | Code point for a glyph hint | everywhere |

For hand-drawn animation, see `src/engine/frames.ts` and `hearth.ts`: text frames with per-frame timing, a static base layer, and automatic scaling to any grid size.

## Techniques worth borrowing

- **Precompute what doesn't move.** Event Horizon traces every cell's bent light path once per layout (about 60 ms at 1080p) into a lookup map, then shades the rotating disk through that map each tick.
- **Avoid runaway shear.** For differentially rotating textures (accretion disks, whirlpools), crossfade two texture layers whose clocks reset while invisible; see `blackhole.ts`.
- **Signals over a network.** Mycelium runs a breadth-first search from a source cell and lights cells whose distance matches a moving front; any graph-like structure (roots, rivers, circuits) can reuse it.
