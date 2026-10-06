import type { Grid } from '../engine/grid';
import { clamp, smoothstep } from '../engine/math';
import type { Rng } from '../engine/rng';
import type { SceneDef } from '../engine/types';
import { cp } from './kit';

type RGB = [number, number, number];
// [wax, liquid] color pairs, like the classic lamps
const PAIRS: [RGB, RGB][] = [
  [[1, 0.32, 0.12], [1, 0.72, 0.28]],
  [[0.35, 0.55, 1], [0.75, 0.35, 1]],
  [[0.35, 1, 0.45], [0.2, 0.6, 1]],
];

interface Blob { x: number; y: number; r: number; temp: number; vy: number; vx: number; grow: number }

interface Lamp {
  cx: number; // center column
  top: number; // glass top row
  H: number; // glass height in rows
  W: number; // half width at the widest point, in square units
  blobs: Blob[];
  pool: number; // pool area (r^2), at the bottom of the glass
  wax: RGB;
  liquid: RGB;
  bud: number;
}

/** Half-width of the glass at fraction f (0 top .. 1 bottom): a slim neck swelling low down. */
function glassWidth(W: number, f: number) {
  if (f < 0.78) return W * (0.42 + 0.58 * Math.sin((f / 0.78) * Math.PI * 0.5));
  return W * (1 - (f - 0.78) * 1.1);
}

/**
 * Lava lamps on a dark shelf. Wax heats at the bulb, rises in slow stretched blobs, cools near
 * the cap and sinks, merging back into the pool, which buds new blobs. The metaball surface lets
 * blobs flow together and pinch apart, and each lamp washes the wall in its own color.
 */
const lavalamp: SceneDef = {
  id: 'lavalamp',
  name: 'Lava Lamps',
  family: 'simulation',
  blurb: 'Warm wax blobs rising and falling in glowing glass',
  recommended: { style: 'firelight' },
  defaultSeed: 1963,
  params: [
    { key: 'lamps', label: 'Lamps', min: 1, max: 3, default: 2, step: 1 },
    { key: 'heat', label: 'Heat', min: 0.3, max: 2.5, default: 1 },
    { key: 'wax', label: 'Wax', min: 0.3, max: 1, default: 0.7 },
    { key: 'glow', label: 'Glow', min: 0.2, max: 1.5, default: 1 },
  ],
  create() {
    let cols = 0, rows = 0, aspect = 0.6, t = 0;
    let rng!: Rng;
    let lamps: Lamp[] = [];
    let built = 0, kick = 0;
    // the room never changes between rebuilds, so its lighting is computed once
    let roomV = new Float32Array(0), roomC = new Float32Array(0), roomG = new Uint32Array(0), shelf = 0;

    const build = (count: number) => {
      lamps = [];
      built = count;
      const H = rows * 0.5;
      const W = Math.min(rows * 0.13, (cols * aspect) / (count * 2.6) * 0.75);
      const offset = rng.int(0, 3);
      for (let k = 0; k < count; k++) {
        const pair = PAIRS[(k + offset) % PAIRS.length];
        const lamp: Lamp = {
          cx: Math.round(cols * ((k + 0.5) / count)), top: Math.round(rows * 0.2), H, W,
          blobs: [], pool: (W * 0.6) ** 2, wax: pair[0], liquid: pair[1], bud: rng.range(2, 8),
        };
        for (let b = 0; b < 4; b++) {
          lamp.blobs.push({ x: rng.range(-0.3, 0.3) * W, y: rng.range(0.15, 0.8) * H, r: rng.range(0.14, 0.26) * W, temp: rng(), vy: 0, vx: 0, grow: 1 });
        }
        lamps.push(lamp);
      }
      lightRoom();
    };

    const lightRoom = () => {
      const n = cols * rows;
      roomV = new Float32Array(n); roomC = new Float32Array(n * 3); roomG = new Uint32Array(n);
      shelf = Math.round(rows * 0.86);
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          let v = 0.008, r = 0, g = 0, b = 0, wsum = 0;
          for (const L of lamps) {
            const dx = (x - L.cx) * aspect, dy = y - (L.top + L.H * 0.65);
            const w = Math.exp(-(dx * dx + dy * dy * 0.6) / ((L.W * 4) ** 2));
            v += w * 0.09;
            r += L.liquid[0] * w; g += L.liquid[1] * w; b += L.liquid[2] * w; wsum += w;
          }
          if (y >= shelf) {
            // the shelf: a lit edge and reflections of each lamp's glow
            v = y === shelf ? 0.1 : 0.02;
            for (const L of lamps) {
              const dx = Math.abs(x - L.cx) * aspect;
              v += (y === shelf ? 0.25 : 0.1 * Math.exp(-(y - shelf) / 2)) * Math.exp(-(dx * dx) / ((L.W * 1.6) ** 2));
            }
          }
          roomV[i] = v;
          const c = i * 3;
          if (wsum > 0.001) { roomC[c] = r / wsum; roomC[c + 1] = g / wsum; roomC[c + 2] = b / wsum; }
          else { roomC[c] = 0.6; roomC[c + 1] = 0.5; roomC[c + 2] = 0.45; }
          if (y === shelf) roomG[i] = cp('_');
        }
      }
    };

    return {
      init(ctx) {
        cols = ctx.cols; rows = ctx.rows; aspect = ctx.aspect; rng = ctx.rng;
        build(Math.round(ctx.params.lamps));
        t = rng() * 100;
      },
      update(dt, audio, ctx) {
        t += dt;
        if (Math.round(ctx.params.lamps) !== built) build(Math.round(ctx.params.lamps));
        kick += (audio.bands[0] - kick) * Math.min(1, dt * 1.5);
        const heat = ctx.params.heat * (1 + kick * 0.4);
        for (const L of lamps) {
          const poolR = Math.sqrt(L.pool);
          const poolTop = L.H - poolR * 0.8;
          // the pool buds a new blob now and then, if there is wax to spare
          L.bud -= dt * heat;
          if (L.bud <= 0 && L.blobs.length < 3 + Math.round(ctx.params.wax * 6) && L.pool > (L.W * 0.45) ** 2) {
            const r = rng.range(0.14, 0.26) * L.W;
            L.pool -= r * r;
            L.blobs.push({ x: rng.range(-0.2, 0.2) * L.W, y: poolTop, r, temp: 0.85, vy: 0, vx: 0, grow: 0 });
            L.bud = rng.range(10, 25);
          }
          for (const b of L.blobs) {
            b.grow = Math.min(1, b.grow + dt * 0.25);
            const f = b.y / L.H;
            // heated near the bulb, cooled near the cap; buoyancy follows temperature
            b.temp += dt * (0.09 * heat * smoothstep(0.65, 1, f) - 0.05 * smoothstep(0.55, 0, f) - 0.008);
            b.temp = clamp(b.temp);
            b.vy += (-(b.temp - 0.5) * 1.2 * heat - b.vy * 0.6) * dt;
            b.vx += (Math.sin(t * 0.13 + b.r * 7) * 0.05 - b.x / L.W * 0.08 - b.vx * 0.8) * dt;
            b.y += b.vy * dt * L.H * 0.06;
            b.x += b.vx * dt * L.W;
            const w = glassWidth(L.W, clamp(b.y / L.H)) - b.r * 0.7;
            if (b.x > w) { b.x = w; b.vx = -Math.abs(b.vx); }
            if (b.x < -w) { b.x = -w; b.vx = Math.abs(b.vx); }
            if (b.y < b.r) { b.y = b.r; b.vy = Math.abs(b.vy) * 0.2; }
          }
          // a cooled blob that sinks back into the pool merges with it
          L.blobs = L.blobs.filter((b) => {
            if (b.y > poolTop && b.vy > 0 && b.grow >= 1) {
              L.pool += b.r * b.r;
              return false;
            }
            return true;
          });
          // big, hot blobs stretch and split in two
          for (const b of [...L.blobs]) {
            if (b.r > L.W * 0.38 && b.y < L.H * 0.6 && rng() < dt * 0.05) {
              const r = b.r / Math.SQRT2;
              b.r = r;
              L.blobs.push({ ...b, y: b.y + r * 1.4, vy: b.vy * 0.5, temp: b.temp - 0.15 });
            }
          }
        }
      },
      event() {
        // the big one: a huge blob lifts slowly off the pool
        const L = lamps[Math.floor(rng() * lamps.length)];
        if (!L) return;
        const r = L.W * 0.42;
        L.pool = Math.max((L.W * 0.3) ** 2, L.pool - r * r * 0.6);
        L.blobs.push({ x: 0, y: L.H - Math.sqrt(L.pool), r, temp: 1, vy: 0, vx: 0, grow: 0 });
      },
      render(grid, ctx) {
        const glow = ctx.params.glow;
        const V = grid.v;
        for (let i = 0; i < V.length; i++) V[i] = clamp(roomV[i] * glow);
        grid.col.set(roomC);
        grid.glyph.set(roomG);
        for (const L of lamps) drawLamp(grid, L, aspect, glow, shelf);
      },
    };
  },
};

function drawLamp(grid: Grid, L: Lamp, aspect: number, glow: number, shelf: number) {
  const { cx, top, H, W } = L;
  const poolR = Math.sqrt(L.pool);
  const rows = Math.ceil(H);
  // glass, liquid and wax
  for (let yy = 0; yy <= rows; yy++) {
    const f = yy / H;
    const hw = glassWidth(W, Math.min(1, f));
    const half = hw / aspect;
    for (let xx = Math.floor(-half) - 1; xx <= Math.ceil(half) + 1; xx++) {
      const sxs = xx * aspect; // square units from the axis
      const x = cx + xx, y = top + yy;
      if (!grid.inside(x, y)) continue;
      if (Math.abs(sxs) > hw + aspect * 0.5) continue;
      if (Math.abs(sxs) > hw - aspect * 0.5) {
        // the glass wall, with a soft highlight on the left
        grid.set(x, y, 0.22 * glow, 0.85, 0.85, 0.9, cp(sxs < 0 ? '(' : ')'));
        continue;
      }
      // metaball field: the pool at the bottom plus every blob (stretched along its motion)
      let F = (poolR * poolR) / (sxs * sxs + (yy - H) ** 2 + 0.01) * 0.9;
      for (const b of L.blobs) {
        const stretch = 1 + Math.min(0.6, Math.abs(b.vy) * 0.8);
        const dx = (sxs - b.x) * stretch, dy = (yy - b.y) / stretch;
        const r = b.r * (0.3 + 0.7 * b.grow);
        F += (r * r) / (dx * dx + dy * dy + 0.01);
      }
      // the bulb lights the liquid from below
      const lit = 0.55 + 0.45 * smoothstep(0, 1, f);
      const i = y * grid.cols + x;
      const c = i * 3;
      if (F > 1) {
        const edge = F < 1.35;
        const shade = clamp(0.62 + 0.25 * lit + (sxs < 0 ? 0.08 : -0.05) - (edge ? 0.12 : 0));
        grid.v[i] = clamp(shade * glow);
        grid.glyph[i] = edge ? cp(sxs < 0 ? '(' : ')') : 0;
        grid.col[c] = L.wax[0]; grid.col[c + 1] = L.wax[1]; grid.col[c + 2] = L.wax[2];
      } else {
        const highlight = Math.abs(sxs + hw * 0.55) < aspect * 0.6 ? 0.08 : 0;
        grid.v[i] = clamp((0.14 + 0.16 * lit + F * 0.1 + highlight) * glow);
        grid.glyph[i] = 0;
        grid.col[c] = L.liquid[0]; grid.col[c + 1] = L.liquid[1]; grid.col[c + 2] = L.liquid[2];
      }
    }
  }
  // chrome cap and base: cones with a vertical highlight
  const metal = (y0: number, h: number, wTop: number, wBot: number) => {
    for (let k = 0; k < h; k++) {
      const f = h > 1 ? k / (h - 1) : 0;
      const hw = wTop + (wBot - wTop) * f;
      const half = hw / aspect;
      for (let xx = Math.floor(-half); xx <= Math.ceil(half); xx++) {
        const sxs = xx * aspect;
        if (Math.abs(sxs) > hw) continue;
        const edge = Math.abs(sxs) > hw - aspect;
        const spec = Math.exp(-(((sxs / hw) + 0.35) ** 2) / 0.02) * 0.5;
        const v = clamp((0.1 + spec + 0.1 * Math.sin(sxs * 1.5)) * glow);
        grid.set(cx + xx, y0 + k, v, 0.8, 0.82, 0.88, edge ? cp(sxs < 0 ? (wBot > wTop ? '/' : '\\') : (wBot > wTop ? '\\' : '/')) : 0);
      }
    }
  };
  const capH = Math.max(2, Math.round(H * 0.16));
  metal(top - capH, capH, W * 0.18, glassWidth(W, 0) + aspect * 0.3);
  const baseTop = top + Math.ceil(H) + 1;
  metal(baseTop, Math.max(2, shelf - baseTop), glassWidth(W, 1) + aspect * 0.3, W * 1.05);
}

export default lavalamp;
