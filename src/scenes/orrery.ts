import type { Grid } from '../engine/grid';
import { clamp, smoothstep, TAU } from '../engine/math';
import type { Rng } from '../engine/rng';
import type { SceneDef } from '../engine/types';
import { cp, lineGlyph, StarField } from './kit';

type RGB = [number, number, number];
const BRASS: RGB = [1, 0.78, 0.42];
const STEEL: RGB = [0.75, 0.8, 0.85];

interface Planet { orbit: number; period: number; size: number; color: RGB; phase: number; moon?: boolean; ring?: boolean; bands?: boolean }

const PLANETS: Planet[] = [
  { orbit: 0.2, period: 1, size: 0.5, color: [0.75, 0.72, 0.7], phase: 0 },
  { orbit: 0.32, period: 1.9, size: 0.8, color: [1, 0.9, 0.6], phase: 0 },
  { orbit: 0.45, period: 3.2, size: 0.85, color: [0.35, 0.65, 1], phase: 0, moon: true },
  { orbit: 0.58, period: 5.4, size: 0.65, color: [1, 0.45, 0.3], phase: 0 },
  { orbit: 0.76, period: 10, size: 1.5, color: [1, 0.75, 0.5], phase: 0, bands: true },
  { orbit: 0.94, period: 16, size: 1.25, color: [1, 0.88, 0.62], phase: 0, ring: true },
];

/** A gear: rim, teeth, spokes and hub, turning at `angle`. r is in rows; x, y in cells. */
function drawGear(grid: Grid, x0: number, y0: number, r: number, teeth: number, angle: number, aspect: number, b: number, col: RGB) {
  const ext = r + 1;
  for (let yy = Math.floor(y0 - ext); yy <= y0 + ext; yy++) {
    for (let xx = Math.floor(x0 - ext / aspect); xx <= x0 + ext / aspect; xx++) {
      const dx = (xx + 0.5 - x0) * aspect, dy = yy + 0.5 - y0;
      const rho = Math.hypot(dx, dy);
      if (rho > r + 0.95) continue;
      const phi = Math.atan2(dy, dx) - angle;
      let v = 0, g = 0;
      if (rho > r - 0.15) {
        // teeth stand proud of the rim, alternating with gaps
        const k = ((phi / TAU) * teeth) % 1;
        if ((k + 1) % 1 < 0.5) { v = 0.55; g = cp('#'); }
      } else if (rho > r - 0.75) {
        v = 0.42; g = cp('O');
      } else if (rho < 0.7) {
        v = 0.7; g = cp('@');
      } else {
        // five spokes
        const s = ((phi / TAU) * 5) % 1;
        const off = Math.min((s + 1) % 1, 1 - ((s + 1) % 1)) * (TAU / 5) * rho;
        if (off < 0.35) { v = 0.38; g = lineGlyph(Math.cos(phi + angle), Math.sin(phi + angle), aspect); }
      }
      if (v > 0) grid.max(xx, yy, v * b, col[0], col[1], col[2], g);
    }
  }
}

/**
 * A clockwork universe: a brass orrery with the sun at its heart and planets on arms, carried
 * round by a visible gear train. Moves smoothly, or in the small eased steps of an escapement.
 * Rarely, a comet sweeps through, its tail always pointing away from the sun.
 */
const orrery: SceneDef = {
  id: 'orrery',
  name: 'Clockwork Universe',
  family: 'scenic',
  blurb: 'A brass orrery turned by meshing gears',
  recommended: { style: 'firelight' },
  defaultSeed: 1687,
  params: [
    { key: 'speed', label: 'Speed', min: 0.1, max: 3, default: 1 },
    { key: 'tilt', label: 'Tilt', min: 0.2, max: 0.9, default: 0.45 },
    { key: 'tick', label: 'Escapement', min: 0, max: 1, default: 0.6 },
    { key: 'gears', label: 'Gears', min: 0, max: 1, default: 0.8 },
  ],
  create() {
    let cols = 0, rows = 0, aspect = 0.6, t = 0, clock = 0, glow = 0;
    let rng!: Rng;
    const stars = new StarField();
    const phases = PLANETS.map(() => 0);
    let comet = -1, cometA = 0, cometDir = 1;

    return {
      init(ctx) {
        cols = ctx.cols; rows = ctx.rows; aspect = ctx.aspect; rng = ctx.rng;
        stars.init(rng, cols, rows, aspect, { density: 0.015 });
        PLANETS.forEach((_, k) => (phases[k] = rng() * TAU));
        t = rng() * 100;
        clock = 0;
        comet = -1;
      },
      update(dt, audio, ctx) {
        t += dt;
        // escapement: the movement advances in eased one-second steps, blended with smooth motion
        const tick = ctx.params.tick;
        const steady = t;
        const stepped = Math.floor(t) + smoothstep(0, 0.3, t % 1);
        const target = (steady * (1 - tick) + stepped * tick) * ctx.params.speed;
        clock += (target - clock) * Math.min(1, dt * 20);
        glow += (audio.bands[0] * 0.3 - glow) * Math.min(1, dt * 2);
        if (comet >= 0) {
          comet += dt;
          if (comet > 60) comet = -1;
        }
      },
      event() {
        comet = 0;
        cometA = rng() * TAU;
        cometDir = rng() < 0.5 ? 1 : -1;
      },
      render(grid, ctx) {
        const V = grid.v, C = grid.col;
        for (let i = 0; i < V.length; i++) {
          V[i] = 0.01;
          C[i * 3] = 0.6; C[i * 3 + 1] = 0.5; C[i * 3 + 2] = 0.4;
        }
        stars.render(grid, t, aspect, 0, { brightness: 0.7 });
        const tilt = ctx.params.tilt;
        const gearAmt = ctx.params.gears;
        const cx = cols / 2, cy = rows * 0.44;
        const R = Math.min((cols * aspect) / 2.2, rows * 0.42 / Math.max(0.35, Math.sin(tilt)));
        const proj = (X: number, Z: number): [number, number] => [cx + (X * R) / aspect, cy + Z * R * Math.sin(tilt)];

        // pedestal and gear train below the system
        const baseY = Math.round(cy + R * Math.sin(tilt) + rows * 0.08);
        if (gearAmt > 0) {
          for (let y = Math.ceil(cy + 2); y < Math.min(rows, baseY + 2); y++) {
            grid.max(cx - 1, y, 0.25 * gearAmt, BRASS[0], BRASS[1], BRASS[2], cp('|'));
            grid.max(cx + 1, y, 0.25 * gearAmt, BRASS[0], BRASS[1], BRASS[2], cp('|'));
          }
          // a big wheel turning slowly behind the sun
          drawGear(grid, cx, cy, Math.min(rows * 0.2, R * 0.28), 36, clock * 0.05, aspect, 0.35 * gearAmt, BRASS);
          // the train: meshing gears, each turning the next the other way
          const radii = [rows * 0.05, rows * 0.085, rows * 0.06, rows * 0.1, rows * 0.055, rows * 0.075, rows * 0.05].map((r) => Math.max(1.6, r));
          let x = cx - radii.reduce((s, r) => s + r * 2 + 0.9, 0) / aspect / 2;
          let w = 0.6, ang = clock * w;
          for (let k = 0; k < radii.length; k++) {
            const r = radii[k];
            const teeth = Math.max(8, Math.round(r * 4.5));
            x += r / aspect;
            if (k > 0) {
              w = -w * radii[k - 1] / r;
              ang = clock * w + Math.PI / teeth; // offset half a tooth so they mesh
            }
            drawGear(grid, x, baseY + (k % 2 ? -0.4 : 0.4), r, teeth, ang, aspect, 0.8 * gearAmt, k % 3 === 1 ? STEEL : BRASS);
            x += (r + 0.9) / aspect;
          }
        }

        // orbits: faint dotted ellipses
        for (const p of PLANETS) {
          const steps = Math.ceil(p.orbit * R * 4);
          for (let s = 0; s < steps; s += 2) {
            const a = (s / steps) * TAU;
            const [x, y] = proj(Math.cos(a) * p.orbit, Math.sin(a) * p.orbit);
            grid.max(x, y, 0.1, BRASS[0], BRASS[1], BRASS[2], cp('.'));
          }
        }

        // planets: far side first, then the sun, then the near side so depth reads correctly
        const order = PLANETS.map((p, k) => ({ p, k, a: phases[k] + (clock / (p.period * 4)) * TAU }))
          .map((o) => ({ ...o, z: Math.sin(o.a) }));
        const drawPlanet = (o: { p: Planet; a: number; z: number }) => {
          const { p, a } = o;
          const X = Math.cos(a) * p.orbit, Z = Math.sin(a) * p.orbit;
          const [px, py] = proj(X, Z);
          const r = p.size * Math.max(1, rows / 32); // planet radius in rows, scaled to the screen
          const lift = r + 1.2; // planets ride on short posts above their arms
          // arm from the hub
          const [hx, hy] = [cx, cy];
          const len = Math.hypot((px - hx) * aspect, py - hy);
          for (let s = 1; s < len; s += 0.8) {
            const f = s / len;
            const x = hx + (px - hx) * f, y = hy + (py - hy) * f;
            grid.max(x, y, 0.22, BRASS[0], BRASS[1], BRASS[2], lineGlyph(px - hx, py - hy, aspect));
          }
          for (let k = 1; k < lift; k++) grid.max(px, py - k, 0.25, BRASS[0], BRASS[1], BRASS[2], cp('|'));
          const ccx = px, ccy = py - lift;
          // lit from the sun's direction
          const lx = -X, lz = -Z, ll = Math.hypot(lx, lz) || 1;
          for (let yy = Math.floor(ccy - r - 1); yy <= ccy + r + 1; yy++) {
            for (let xx = Math.floor(ccx - (r + 1) / aspect); xx <= ccx + (r + 1) / aspect; xx++) {
              const dx = (xx + 0.5 - ccx) * aspect, dy = yy + 0.5 - ccy;
              const d = Math.hypot(dx, dy) / r;
              if (d > 1.05) {
                if (p.ring) {
                  // Saturn's rings: a flat ellipse around the planet
                  const er = Math.hypot(dx / 2.1, dy / (2.1 * Math.max(0.25, Math.sin(tilt)) * 0.9));
                  if (er > r * 0.75 && er < r * 1.05) grid.max(xx, yy, 0.5, 0.95, 0.85, 0.65, cp('-'));
                }
                continue;
              }
              const nx = dx / r, nz = Math.sqrt(Math.max(0, 1 - d * d));
              const light = clamp(0.25 + 0.75 * ((nx * lx) / ll + nz * 0.35));
              let v = 0.25 + 0.65 * light;
              if (p.bands) v *= 0.8 + 0.2 * Math.sin(dy * 3.2);
              grid.max(xx, yy, clamp(v), p.color[0], p.color[1], p.color[2]);
            }
          }
          if (p.moon) {
            const ma = clock * 0.9;
            grid.max(ccx + (Math.cos(ma) * (r + 1.6)) / aspect, ccy + Math.sin(ma) * (r + 1.6) * Math.sin(tilt), 0.6, 0.85, 0.85, 0.8, cp('o'));
          }
        };
        order.filter((o) => o.z < 0).forEach(drawPlanet);
        // the sun: a glowing disc with a slowly churning surface
        const sr = Math.max(2, rows * 0.06);
        for (let yy = Math.floor(cy - sr * 2); yy <= cy + sr * 2; yy++) {
          for (let xx = Math.floor(cx - (sr * 2) / aspect); xx <= cx + (sr * 2) / aspect; xx++) {
            const dx = (xx + 0.5 - cx) * aspect, dy = yy + 0.5 - cy;
            const d = Math.hypot(dx, dy) / sr;
            if (d < 1) {
              const churn = ctx.noise.n3(dx * 0.6, dy * 0.6, t * 0.2) * 0.15;
              grid.set(xx, yy, clamp(0.85 + churn + glow), 1, 0.85 - d * 0.25, 0.45);
            } else if (d < 2) {
              grid.max(xx, yy, (2 - d) * (0.3 + glow * 0.5), 1, 0.7, 0.3);
            }
          }
        }
        order.filter((o) => o.z >= 0).forEach(drawPlanet);

        // a comet swinging through, tail streaming away from the sun
        if (comet >= 0) {
          const u = (comet / 60) * 2 - 1; // -1 .. 1 along its path
          const dist = 0.25 + 1.6 * u * u;
          const a = cometA + cometDir * Math.atan(u * 3) * 1.4;
          const X = Math.cos(a) * dist, Z = Math.sin(a) * dist;
          const [hx, hy] = proj(X, Z);
          const fade = smoothstep(0, 6, comet) * smoothstep(60, 52, comet);
          const bright = fade * clamp(0.5 + 0.5 / dist);
          grid.max(hx, hy, bright, 0.85, 0.95, 1, cp('*'));
          const tl = 4 + 10 / dist;
          for (let k = 1; k < tl; k++) {
            const f = k / tl;
            const [tx, ty] = proj(X * (1 + f * 0.35 / dist), Z * (1 + f * 0.35 / dist));
            grid.max(tx, ty, bright * (1 - f) * 0.8, 0.6, 0.85, 1, lineGlyph(tx - hx, ty - hy, aspect));
          }
        }
      },
    };
  },
};

export default orrery;
