import type { Grid } from '../engine/grid';
import { clamp, smoothstep } from '../engine/math';
import { hash2, type Rng } from '../engine/rng';
import type { SceneDef } from '../engine/types';
import { cp, drawJelly, lineGlyph, Motes, swimJelly, type Jelly } from './kit';

type RGB = [number, number, number];
const GLOWS: RGB[] = [
  [0.3, 1, 0.85], // cyan
  [0.45, 1, 0.45], // green
  [1, 0.4, 0.9], // magenta
  [0.45, 0.6, 1], // blue
  [1, 0.72, 0.3], // amber
];

interface CoralCell { x: number; y: number; g: number; along: number; tip: boolean }
interface Coral { cells: CoralCell[]; color: RGB; phase: number; speed: number }
interface Anemone { x: number; y: number; n: number; len: number; color: RGB; phase: number }
interface School { x: number; y: number; dir: number; speed: number; count: number; seed: number; color: RGB }
interface Grass { x: number; h: number; phase: number }

/**
 * A reef at night: corals whose tips pulse with light that climbs their branches, anemones
 * waving glowing tentacles, jellyfish pulsing through the water, and plankton that sparks
 * blue-green wherever fish swim. Rarely, a manta ray glides over and lights up its wake.
 */
const reef: SceneDef = {
  id: 'reef',
  name: 'Glow Reef',
  family: 'scenic',
  blurb: 'Bioluminescent corals, jellyfish and sparking plankton',
  recommended: { style: 'midnight' },
  defaultSeed: 2207,
  params: [
    { key: 'glow', label: 'Glow', min: 0.2, max: 1.5, default: 1 },
    { key: 'life', label: 'Sea life', min: 0, max: 1, default: 0.6 },
    { key: 'current', label: 'Current', min: 0, max: 2, default: 0.7 },
    { key: 'plankton', label: 'Plankton', min: 0, max: 1, default: 0.6 },
  ],
  create() {
    let cols = 0, rows = 0, aspect = 0.6, t = 0;
    let rng!: Rng;
    let floor = new Float32Array(0);
    let corals: Coral[] = [], anemones: Anemone[] = [], jellies: Jelly[] = [], schools: School[] = [], grass: Grass[] = [];
    const plankton = new Motes();
    let manta = -1, mantaX = 0, mantaY = 0, mantaDir = 1, mantaSize = 1, sinceBeat = 10, jellyKick = 0;

    const floorAt = (x: number) => floor[Math.max(0, Math.min(cols - 1, x | 0))];

    /** A branching coral grown from its base, recorded as glyph cells. */
    const growBranching = (x0: number, y0: number, height: number, spread: number): CoralCell[] => {
      const cells: CoralCell[] = [];
      const grow = (x: number, y: number, ang: number, len: number, depth: number, along: number) => {
        for (let s = 0; s < len; s++) {
          const nx = x + (Math.sin(ang) / aspect) * 1, ny = y - Math.cos(ang);
          cells.push({ x: nx, y: ny, g: lineGlyph(nx - x, ny - y, aspect), along: along + s, tip: false });
          x = nx; y = ny;
          ang += (rng() - 0.5) * 0.25;
        }
        if (depth >= 4 || len < 2) {
          cells[cells.length - 1].tip = true;
          return;
        }
        const k = rng() < 0.3 ? 3 : 2;
        for (let j = 0; j < k; j++) {
          const a = ang + (j - (k - 1) / 2) * spread * rng.range(0.7, 1.3);
          grow(x, y, a, Math.max(1, Math.round(len * rng.range(0.55, 0.8))), depth + 1, along + len);
        }
      };
      grow(x0, y0, rng.range(-0.15, 0.15), Math.max(2, Math.round(height * 0.32)), 0, 0);
      return cells;
    };

    /** A rounded brain coral: a dome of grooved texture. */
    const growDome = (x0: number, y0: number, r: number): CoralCell[] => {
      const cells: CoralCell[] = [];
      const rx = r / aspect;
      for (let yy = -Math.ceil(r); yy <= 0; yy++) {
        for (let xx = -Math.ceil(rx); xx <= rx; xx++) {
          const d = Math.hypot(xx * aspect, yy) / r;
          if (d > 1) continue;
          const groove = Math.sin(xx * 1.3 + Math.sin(yy * 1.7) * 2) > 0.2;
          cells.push({ x: x0 + xx, y: y0 + yy, g: cp(d > 0.85 ? (xx < 0 ? '(' : ')') : groove ? '~' : '-'), along: (1 - d) * 6, tip: d > 0.85 && yy < -r * 0.5 });
        }
      }
      return cells;
    };

    return {
      init(ctx) {
        cols = ctx.cols; rows = ctx.rows; aspect = ctx.aspect; rng = ctx.rng;
        floor = new Float32Array(cols);
        for (let x = 0; x < cols; x++) {
          floor[x] = rows * (0.84 - 0.06 * ctx.noise.fbm2(x * aspect * 0.015, 1.7, 3) - 0.03 * Math.max(0, ctx.noise.n2(x * aspect * 0.08, 4)));
        }
        corals = []; anemones = []; grass = [];
        // Corals along the floor, spaced so they don't pile up.
        for (let x = rng.range(2, 8); x < cols - 2; x += rng.range(7, 16) * (rows / 50 + 0.5)) {
          const base = Math.floor(floorAt(x));
          const color = rng.pick(GLOWS);
          const kind = rng();
          const height = rows * rng.range(0.14, 0.32);
          const cells = kind < 0.55 ? growBranching(x, base, height, rng.range(0.35, 0.75))
            : kind < 0.8 ? growDome(Math.round(x), base, rng.range(2, Math.max(2.5, rows * 0.07)))
            : growBranching(x, base, height * 1.2, rng.range(0.9, 1.3)); // a wide sea fan
          corals.push({ cells, color, phase: rng() * 10, speed: rng.range(0.4, 0.9) });
        }
        for (let k = 0; k < Math.max(2, Math.floor(cols / 40)); k++) {
          const x = rng() * cols;
          anemones.push({ x, y: floorAt(x), n: rng.int(5, 9), len: rng.range(3, Math.max(4, rows * 0.08)), color: rng.pick(GLOWS), phase: rng() * 6 });
        }
        for (let x = 0; x < cols; x += rng.range(1.5, 5)) grass.push({ x, h: rng.range(2, Math.max(3, rows * 0.12)), phase: rng() * 6 });
        jellies = [];
        for (let k = 0; k < 3; k++) {
          jellies.push({
            kind: 'bell', x: rng() * cols, y: rows * rng.range(0.15, 0.6), size: rng.range(1.5, Math.max(2, rows * 0.045)),
            phase: rng() * 5, period: rng.range(3, 5), color: rng.pick(GLOWS), drift: rng.range(-0.6, 0.6),
          });
        }
        schools = [];
        for (let k = 0; k < 2; k++) {
          const dir = rng() < 0.5 ? 1 : -1;
          schools.push({ x: rng() * cols, y: rows * rng.range(0.3, 0.65), dir, speed: rng.range(2, 4.5), count: rng.int(4, 9), seed: rng() * 100, color: rng.pick(GLOWS) });
        }
        plankton.init(rng, cols, rows, Math.floor((cols * rows) / 14), 0, rows);
        t = rng() * 100;
        manta = -1;
      },
      update(dt, audio, ctx) {
        t += dt;
        const cur = ctx.params.current;
        plankton.update(dt, ctx.noise, t, { drift: 1.2 * cur, rise: -0.05 });
        jellyKick = Math.max(jellyKick * Math.exp(-dt * 2), audio.bands[0]);
        const life = ctx.params.life;
        for (const j of jellies) {
          const thrust = swimJelly(j, dt, { kick: jellyKick, current: cur, t });
          if (j.y < -j.size * 3) j.y = rows * 0.75;
          if (j.y > rows * 0.8) j.y = rows * 0.8;
          if (j.x < -6) j.x += cols + 12;
          if (j.x > cols + 6) j.x -= cols + 12;
          if (thrust > 0.5) plankton.excite(j.x, j.y + j.size, j.size * 2, 0.15 * dt * 30, aspect);
        }
        for (const s of schools) {
          s.x += s.dir * s.speed * dt * (0.5 + life);
          s.y += Math.sin(t * 0.3 + s.seed) * dt * 0.8;
          if (s.dir > 0 && s.x > cols + 20) { s.x = -20; s.y = rows * rng.range(0.25, 0.65); }
          if (s.dir < 0 && s.x < -20) { s.x = cols + 20; s.y = rows * rng.range(0.25, 0.65); }
          // fish leave a sparkling wake in the plankton
          for (let k = 0; k < s.count; k++) {
            const fx = s.x - s.dir * k * 3.2 + Math.sin(s.seed + k * 2.1) * 2, fy = s.y + Math.sin(s.seed * 2 + k * 1.7) * 2.5;
            plankton.excite(fx, fy, 2.2, 0.25, aspect);
          }
        }
        sinceBeat += dt;
        if (audio.beat > 0.8 && sinceBeat > 1) {
          sinceBeat = 0;
          plankton.excite(rng() * cols, rng() * rows * 0.7, 6, 0.8, aspect);
        }
        if (manta >= 0) {
          manta += dt;
          mantaX += mantaDir * dt * cols * 0.025;
          mantaY += Math.sin(manta * 0.25) * dt * 0.6;
          // its wingtips churn up a long glowing wake
          plankton.excite(mantaX, mantaY, mantaSize * 1.2, 0.5, aspect);
          if (mantaX < -cols * 0.4 || mantaX > cols * 1.4) manta = -1;
        }
      },
      event() {
        manta = 0;
        mantaDir = rng() < 0.5 ? 1 : -1;
        mantaSize = Math.min(cols * aspect * 0.18, rows * 0.22);
        mantaX = mantaDir > 0 ? -mantaSize / aspect : cols + mantaSize / aspect;
        mantaY = rows * rng.range(0.25, 0.45);
      },
      render(grid, ctx) {
        const V = grid.v, C = grid.col, G = grid.glyph;
        const glow = ctx.params.glow;
        const cur = ctx.params.current;
        // Water: faint light from far above, slow drifting shafts, darker toward the floor
        for (let y = 0; y < rows; y++) {
          const depth = y / rows;
          for (let x = 0; x < cols; x++) {
            const i = y * cols + x;
            const shaft = smoothstep(0.35, 0.8, ctx.noise.n2(x * aspect * 0.035 + y * 0.012 - t * 0.015, 3.3));
            V[i] = 0.012 + 0.035 * (1 - depth) ** 2 + shaft * 0.03 * (1 - depth);
            const c = i * 3;
            C[c] = 0.12; C[c + 1] = 0.35; C[c + 2] = 0.6;
          }
        }
        plankton.render(grid, t, 0.11 * ctx.params.plankton * (0.6 + glow * 0.4), [0.25, 0.6, 1], [0.6, 1, 0.95]);

        // Seafloor: sand and rubble
        for (let x = 0; x < cols; x++) {
          for (let y = Math.floor(floorAt(x)); y < rows; y++) {
            const i = y * cols + x;
            const h = hash2(x, y, 9);
            V[i] = 0.03 + 0.03 * h;
            G[i] = h > 0.93 ? cp(h > 0.97 ? 'o' : '.') : 0;
            C[i * 3] = 0.45; C[i * 3 + 1] = 0.5; C[i * 3 + 2] = 0.55;
          }
        }
        // Seagrass sways with the current
        for (const s of grass) {
          const base = Math.floor(floorAt(s.x));
          for (let k = 1; k <= s.h; k++) {
            const f = k / s.h;
            const sway = Math.sin(t * 0.6 * (0.5 + cur) + s.phase + k * 0.25) * f * f * 2 * (0.3 + cur);
            const sway2 = Math.sin(t * 0.6 * (0.5 + cur) + s.phase + (k + 1) * 0.25) * f * f * 2 * (0.3 + cur);
            grid.max(s.x + sway, base - k, 0.12 + 0.08 * f, 0.35, 0.75, 0.5, lineGlyph(sway2 - sway, -1, aspect));
          }
        }
        // Corals: light climbs each coral from base to tips, then fades, in its own rhythm
        for (const c of corals) {
          for (const cell of c.cells) {
            const wave = 0.5 + 0.5 * Math.sin(t * c.speed - cell.along * 0.35 + c.phase);
            const b = clamp((cell.tip ? 0.35 + 0.55 * wave : 0.14 + 0.28 * wave * wave) * glow);
            const col = c.color;
            const dim = cell.tip ? 1 : 0.75;
            grid.max(cell.x, cell.y, b, col[0] * dim + (1 - dim) * 0.6, col[1] * dim + (1 - dim) * 0.6, col[2] * dim + (1 - dim) * 0.6, cell.tip ? cp('*') : cell.g);
          }
        }
        // Anemones wave their tentacles; the tips glow
        for (const a of anemones) {
          for (let k = 0; k < a.n; k++) {
            const spread = (k / (a.n - 1) - 0.5) * 1.6;
            let x = a.x, y = a.y - 1;
            for (let s = 0; s < a.len; s++) {
              const ang = spread * (s / a.len + 0.3) + Math.sin(t * 0.8 * (0.4 + cur) + a.phase + k * 0.6 + s * 0.4) * 0.35;
              const nx = x + Math.sin(ang) / aspect * 0.8, ny = y - Math.cos(ang) * 0.8;
              const tip = s === Math.floor(a.len) - 1;
              const pulse = 0.5 + 0.5 * Math.sin(t * 1.1 + a.phase + k);
              grid.max(nx, ny, clamp((tip ? 0.5 + 0.4 * pulse : 0.18) * glow), a.color[0], a.color[1], a.color[2], tip ? cp('o') : lineGlyph(nx - x, ny - y, aspect));
              x = nx; y = ny;
            }
          }
        }
        // Jellyfish: a pulsing bell with trailing tentacles
        const nJ = Math.round(ctx.params.life * 3 + 0.4);
        for (let jIdx = 0; jIdx < Math.min(nJ, jellies.length); jIdx++) drawJelly(grid, jellies[jIdx], t, aspect, glow);
        // Fish: small glowing-eyed silhouettes in loose schools
        const life = ctx.params.life;
        for (let sIdx = 0; sIdx < (life > 0.15 ? schools.length : 0); sIdx++) {
          const s = schools[sIdx];
          const fish = s.dir > 0 ? '><>' : '<><';
          for (let k = 0; k < Math.round(s.count * (0.5 + life * 0.5)); k++) {
            const fx = s.x - s.dir * k * 3.2 + Math.sin(s.seed + k * 2.1) * 2, fy = s.y + Math.sin(s.seed * 2 + k * 1.7) * 2.5 + Math.sin(t * 2 + k) * 0.3;
            grid.text(fx, fy, fish, 0.32, 0.55, 0.75, 0.85);
            grid.max(fx + (s.dir > 0 ? 2 : 0), fy, clamp(0.55 * glow), s.color[0], s.color[1], s.color[2]);
          }
        }
        if (manta >= 0) drawManta(grid, mantaX, mantaY, mantaSize, mantaDir, manta, aspect);
      },
    };
  },
};

/** A manta ray: a broad dark diamond whose wings beat slowly, outlined by stirred-up plankton. */
function drawManta(grid: Grid, cx: number, cy: number, size: number, dir: number, time: number, aspect: number) {
  const beat = Math.sin(time * 0.9);
  const fade = clamp(time / 4);
  for (let yy = -Math.ceil(size * 0.6); yy <= Math.ceil(size * 0.6); yy++) {
    for (let xx = -Math.ceil(size / aspect); xx <= Math.ceil(size / aspect); xx++) {
      const u = (xx * aspect) / size * dir, w = yy / size; // u: along body, w: across (wingspan)
      const span = 0.55 * (1 - Math.abs(u) * 1.1) + 0.08 * beat * Math.abs(w);
      const inBody = Math.abs(w) < span && u > -0.75 && u < 0.6;
      const tail = u < -0.6 && u > -1 && Math.abs(w) < 0.02 + 0.01 * (u + 1);
      if (!inBody && !tail) continue;
      const edge = Math.abs(w) > span - 0.1 || tail;
      const i = Math.round(cy + yy) * grid.cols + Math.round(cx + xx);
      if (!grid.inside(cx + xx, cy + yy)) continue;
      if (edge) {
        grid.max(cx + xx, cy + yy, 0.5 * fade, 0.5, 0.9, 1, cp(tail ? '-' : w < 0 ? '\\' : '/'));
      } else {
        grid.v[i] *= 1 - 0.85 * fade;
        grid.glyph[i] = 0;
      }
    }
  }
}

export default reef;
