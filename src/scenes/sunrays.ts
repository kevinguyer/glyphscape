import type { Grid } from '../engine/grid';
import { clamp, smoothstep } from '../engine/math';
import { hash2, type Rng } from '../engine/rng';
import type { SceneDef } from '../engine/types';
import { cp, lineGlyph, Motes } from './kit';

interface Kelp { x: number; h: number; phase: number }
interface Bubble { x: number; y: number; r: number; wob: number }

/**
 * Looking up through shallow water at midday: the bright, rippling surface overhead, shafts of
 * sunlight that sway and shimmer as the waves pass, caustic light dancing over the sand,
 * swaying kelp, glittering motes, and bubbles drifting up. Rarely, a sea turtle glides past.
 */
const sunrays: SceneDef = {
  id: 'sunrays',
  name: 'Underwater Sunrays',
  family: 'scenic',
  blurb: 'Shafts of sunlight, caustics and kelp in shallow water',
  recommended: { style: 'midnight' },
  defaultSeed: 7272,
  params: [
    { key: 'rays', label: 'Sun rays', min: 0, max: 1.5, default: 1 },
    { key: 'depth', label: 'Depth', min: 0.2, max: 1, default: 0.5 },
    { key: 'swell', label: 'Swell', min: 0, max: 2, default: 0.8 },
    { key: 'motes', label: 'Motes', min: 0, max: 1, default: 0.6 },
  ],
  create() {
    let cols = 0, rows = 0, aspect = 0.6, t = 0, kick = 0;
    let rng!: Rng;
    let surface = 0;
    let floor = new Float32Array(0);
    let ray = new Float32Array(0), rayOff = 0;
    let kelp: Kelp[] = [];
    let bubbles: Bubble[] = [];
    const motes = new Motes();
    let fishX = 0, fishY = 0, fishDir = 1;
    let turtle = -1, turtleX = 0, turtleY = 0, turtleDir = 1;

    /** Shaft intensity at a cell: rays fan out slightly from a sun high up and to one side. */
    const rayAt = (x: number, y: number, slant: number) => {
      const d = y - surface;
      if (d < 0) return 0;
      const s = (x * aspect - cols * aspect * 0.5) * (1 - 0.2 * (d / rows)) + cols * aspect * 0.5 + d * slant;
      const k = s * 2 + rayOff;
      const i = Math.floor(k), f = k - i;
      const a = ray[((i % ray.length) + ray.length) % ray.length], b = ray[(((i + 1) % ray.length) + ray.length) % ray.length];
      return a + (b - a) * f;
    };

    return {
      init(ctx) {
        cols = ctx.cols; rows = ctx.rows; aspect = ctx.aspect; rng = ctx.rng;
        surface = Math.max(2, Math.round(rows * 0.1));
        floor = new Float32Array(cols);
        for (let x = 0; x < cols; x++) floor[x] = rows * (0.84 - 0.05 * ctx.noise.fbm2(x * aspect * 0.012, 3, 3));
        ray = new Float32Array(Math.ceil((cols * aspect + rows) * 2) + 4);
        kelp = [];
        for (let x = rng.range(2, 10); x < cols; x += rng.range(8, 22)) kelp.push({ x, h: rows * rng.range(0.25, 0.55), phase: rng() * 6 });
        bubbles = [];
        motes.init(rng, cols, rows, Math.floor((cols * rows) / 40), surface, rows);
        fishX = rng() * cols; fishY = rows * rng.range(0.35, 0.6); fishDir = rng() < 0.5 ? 1 : -1;
        t = rng() * 100;
        turtle = -1;
      },
      update(dt, audio, ctx) {
        t += dt;
        kick += (audio.bands[0] - kick) * Math.min(1, dt * 2);
        const swell = ctx.params.swell;
        // the shafts: a 1-D pattern along the surface, drifting as the waves roll over
        rayOff += dt * 0.6 * swell;
        for (let i = 0; i < ray.length; i++) {
          const u = i * 0.04;
          const broad = smoothstep(0.15, 0.7, ctx.noise.fbm2(u * 0.5, t * 0.04 * (0.4 + swell), 3) + 0.2);
          const fine = 0.65 + 0.35 * ctx.noise.n2(u * 3, t * 0.6 * (0.4 + swell) + 7);
          ray[i] = broad * broad * broad * fine * (1 + kick * 0.3);
        }
        motes.update(dt, ctx.noise, t, { drift: 0.5 + swell * 0.4, rise: -0.05 });
        // motes glitter as they cross a beam
        const slant = 0.32 + Math.sin(t * 0.05) * 0.06;
        for (let i = 0; i < motes.count; i++) motes.glow[i] = Math.max(motes.glow[i] * 0.9, rayAt(motes.x[i], motes.y[i], slant) * 0.55);
        // bubble streams rise from a couple of vents in the sand
        if (rng() < dt * 1.5) {
          const vent = Math.floor((rng() < 0.5 ? 0.3 : 0.72) * cols + rng.range(-1, 1));
          bubbles.push({ x: vent, y: floor[Math.max(0, Math.min(cols - 1, vent))] - 1, r: rng.range(0.3, 1), wob: rng() * 6 });
        }
        for (const b of bubbles) {
          b.y -= dt * (2 + b.r * 2.5);
          b.x += Math.sin(t * 3 + b.wob) * dt * 0.8;
          b.r = Math.min(1.4, b.r + dt * 0.03); // bubbles grow as the pressure drops
        }
        bubbles = bubbles.filter((b) => b.y > surface);
        fishX += fishDir * dt * 3;
        fishY += Math.sin(t * 0.4) * dt * 0.5;
        if (fishX > cols + 25) { fishX = -25; fishY = rows * rng.range(0.3, 0.65); }
        if (fishX < -25) { fishX = cols + 25; fishY = rows * rng.range(0.3, 0.65); }
        if (turtle >= 0) {
          turtle += dt;
          turtleX += turtleDir * dt * cols * 0.018;
          turtleY += Math.sin(turtle * 0.3) * dt * 0.4;
          if (turtleX < -cols * 0.3 || turtleX > cols * 1.3) turtle = -1;
        }
      },
      event() {
        turtle = 0;
        turtleDir = rng() < 0.5 ? 1 : -1;
        turtleX = turtleDir > 0 ? -cols * 0.15 : cols * 1.15;
        turtleY = rows * rng.range(0.3, 0.5);
      },
      render(grid, ctx) {
        const V = grid.v, C = grid.col, G = grid.glyph;
        const raysAmt = ctx.params.rays;
        const depthFade = rows * (0.25 + ctx.params.depth * 1.1);
        const slant = 0.32 + Math.sin(t * 0.05) * 0.06;
        const swell = ctx.params.swell;
        for (let y = 0; y < rows; y++) {
          const deep = y / rows;
          for (let x = 0; x < cols; x++) {
            const i = y * cols + x;
            const c = i * 3;
            if (y < surface) {
              // the surface from below: bright, rippling, brightest overhead (Snell's window)
              const rip = ctx.noise.n3(x * aspect * 0.12, y * 0.6, t * 0.5 * (0.3 + swell));
              const window = Math.exp(-((((x - cols * 0.5) * aspect) / (cols * aspect * 0.45)) ** 2));
              V[i] = clamp(0.25 + 0.3 * window + 0.25 * rip);
              G[i] = rip > 0.3 ? cp('~') : 0;
              C[c] = 0.7; C[c + 1] = 0.95; C[c + 2] = 1;
              continue;
            }
            const fl = floor[x];
            if (y >= fl) {
              // sand with caustics: a shifting web of focused light
              const n1 = 1 - Math.abs(ctx.noise.n3(x * aspect * 0.16, y * 0.4, t * 0.45 * (0.3 + swell)));
              const n2 = 1 - Math.abs(ctx.noise.n3(x * aspect * 0.23 + 40, y * 0.55, t * 0.6 * (0.3 + swell)));
              const caustic = Math.pow(n1, 7) + Math.pow(n2, 9) * 0.7;
              const lit = clamp(rayAt(x, y, slant) * 1.5 + 0.3) * raysAmt;
              const h = hash2(x, y, 5);
              V[i] = clamp(0.14 + 0.05 * h + caustic * 0.85 * lit);
              G[i] = h > 0.95 ? cp('.') : 0;
              const w = clamp(caustic * lit * 1.5);
              C[c] = 0.95 - 0.25 * w; C[c + 1] = 0.85 + 0.15 * w; C[c + 2] = 0.6 + 0.4 * w;
              continue;
            }
            // open water: lighter above, deep blue below, with shafts of light
            const shaft = rayAt(x, y, slant) * Math.exp(-(y - surface) / depthFade) * raysAmt;
            V[i] = clamp(0.025 + 0.08 * (1 - deep) ** 2 + shaft * 0.75);
            G[i] = 0;
            const w = clamp(shaft * 1.6);
            C[c] = 0.15 + 0.7 * w; C[c + 1] = 0.55 + 0.4 * w; C[c + 2] = 0.75 + 0.2 * w;
          }
        }
        motes.render(grid, t, 0.06 * ctx.params.motes, [0.6, 0.85, 0.9], [1, 1, 0.9]);
        // kelp: tall swaying strands with leaves, dark against the light
        for (const k of kelp) {
          const base = floor[Math.max(0, Math.min(cols - 1, Math.round(k.x)))];
          let x = k.x, y = base;
          for (let s = 1; s < k.h; s++) {
            const f = s / k.h;
            const sway = Math.sin(t * 0.5 * (0.4 + swell) + k.phase + s * 0.12) * f * f * 7 * (0.3 + swell * 0.5);
            const nx = k.x + sway / aspect * 0.5, ny = base - s;
            const lit = rayAt(nx, ny, slant) * raysAmt;
            const v = clamp(0.12 + lit * 0.3);
            grid.set(nx, ny, v, 0.45 + lit * 0.3, 0.7, 0.35, lineGlyph(nx - x, ny - y, aspect));
            if (s % 3 === 0) grid.set(nx + (s % 6 ? 1 : -1), ny, v * 0.9, 0.45, 0.7, 0.35, cp(s % 6 ? ')' : '('));
            x = nx; y = ny;
          }
        }
        // bubbles, bright where the light catches them
        for (const b of bubbles) {
          const lit = rayAt(b.x, b.y, slant);
          grid.max(b.x, b.y, clamp(0.4 + lit * 0.5), 0.85, 1, 1, cp(b.r > 1 ? 'O' : b.r > 0.6 ? 'o' : '°'));
        }
        // a school of small fish, silhouetted against the shafts
        for (let k = 0; k < 7; k++) {
          const fx = fishX - fishDir * k * 3.4 + Math.sin(k * 2.3) * 2, fy = fishY + Math.sin(k * 1.9 + t * 0.6) * 2.2;
          const lit = rayAt(fx, fy, slant);
          grid.text(fx, fy, fishDir > 0 ? '><>' : '<><', clamp(0.25 + lit * 0.4), 0.5, 0.7, 0.85);
        }
        if (turtle >= 0) drawTurtle(grid, turtleX, turtleY, turtleDir, turtle, aspect, rows);
      },
    };
  },
};

/** A sea turtle in silhouette: shell, head and slowly sweeping flippers, rimmed by light from above. */
function drawTurtle(grid: Grid, cx: number, cy: number, dir: number, time: number, aspect: number, rows: number) {
  const S = rows * 0.07;
  const fade = clamp(time / 4);
  const stroke = Math.sin(time * 0.8);
  const blobs: [number, number, number, number][] = [
    [0, 0, S * 1.6, S], // shell (x, y offsets in square units, radii)
    [dir * S * 1.9, -S * 0.15, S * 0.45, S * 0.38], // head
    [dir * S * 0.7, S * (0.9 + 0.5 * stroke), S * 1.1, S * 0.3], // front flipper
    [-dir * S * 1.1, S * (0.75 - 0.3 * stroke), S * 0.6, S * 0.25], // back flipper
  ];
  const span = S * 3;
  for (let yy = Math.floor(cy - span); yy <= cy + span; yy++) {
    for (let xx = Math.floor(cx - span / aspect); xx <= cx + span / aspect; xx++) {
      if (!grid.inside(xx, yy)) continue;
      const dx = (xx + 0.5 - cx) * aspect, dy = yy + 0.5 - cy;
      let inside = false, edgeTop = false;
      for (const [ox, oy, rx, ry] of blobs) {
        const d = ((dx - ox) / rx) ** 2 + ((dy - oy) / ry) ** 2;
        if (d < 1) {
          inside = true;
          if (d > 0.7 && dy < oy) edgeTop = true;
        }
      }
      if (!inside) continue;
      const i = yy * grid.cols + xx;
      if (edgeTop) {
        grid.max(xx, yy, 0.45 * fade, 0.8, 0.95, 0.85, cp('-'));
      } else {
        // the shell's plates show faintly
        const plate = Math.abs(Math.sin(dx * 1.4) * Math.sin(dy * 1.8)) > 0.8;
        grid.v[i] = grid.v[i] * (1 - 0.8 * fade) + (plate ? 0.06 * fade : 0);
        grid.glyph[i] = plate ? cp(':') : 0;
      }
    }
  }
}

export default sunrays;
