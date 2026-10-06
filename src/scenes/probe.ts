import { clamp } from '../engine/math';
import type { SceneDef } from '../engine/types';

const PROBE = [
  '  .-.  ',
  '-=[o]=-',
  "  '-'  ",
];
const ROCK = [
  '  __  ',
  ' /  \\_',
  '(  .  )',
  ' \\__./',
];

interface Probe { x: number; y: number; vx: number; vy: number; state: 'drift' | 'mine' | 'build'; t: number; target: number; gen: number }

/**
 * Secret scene (Konami code): a tiny self-replicating Von Neumann probe drifting across the
 * stars. It finds asteroids, mines them, and builds copies of itself that drift away.
 */
const probe: SceneDef = {
  id: 'probe',
  name: 'Von Neumann',
  family: 'secret',
  blurb: 'A self-replicating probe among the stars',
  recommended: { style: 'clean-mono', colorMode: 'native' },
  defaultSeed: 1966,
  hidden: true,
  params: [
    { key: 'speed', label: 'Speed', min: 0.2, max: 3, default: 1 },
    { key: 'stars', label: 'Stars', min: 0, max: 1, default: 0.6 },
  ],
  create() {
    let cols = 0, rows = 0, t = 0;
    let sx = new Float32Array(0), sy = new Float32Array(0), sd = new Float32Array(0);
    const probes: Probe[] = [];
    const rocks: { x: number; y: number; mass: number }[] = [];
    let rng: () => number = Math.random;

    const newRock = () => ({ x: 8 + rng() * (cols - 16), y: 4 + rng() * (rows - 10), mass: 1 });

    return {
      init(ctx) {
        cols = ctx.cols; rows = ctx.rows; rng = ctx.rng;
        const ns = Math.floor((cols * rows) / 45);
        sx = new Float32Array(ns); sy = new Float32Array(ns); sd = new Float32Array(ns);
        for (let i = 0; i < ns; i++) { sx[i] = rng() * cols; sy[i] = rng() * rows; sd[i] = rng(); }
        probes.length = 0;
        rocks.length = 0;
        for (let i = 0; i < 3; i++) rocks.push(newRock());
        probes.push({ x: -8, y: rows * 0.45, vx: 2.2, vy: 0.15, state: 'drift', t: 0, target: -1, gen: 0 });
      },
      update(dt0, _audio, ctx) {
        const dt = dt0 * ctx.params.speed;
        t += dt;
        for (let i = 0; i < sx.length; i++) {
          sx[i] -= dt * (0.3 + sd[i] * 1.2);
          if (sx[i] < 0) { sx[i] += cols; sy[i] = rng() * rows; }
        }
        for (const p of probes) {
          p.t += dt;
          if (p.state === 'drift') {
            p.x += p.vx * dt; p.y += p.vy * dt;
            // look for a nearby asteroid
            if (p.t > 6) {
              const k = rocks.findIndex((r) => r.mass > 0.2 && Math.abs(r.x - p.x) < 30 && Math.abs(r.y - p.y) < 12);
              if (k >= 0) { p.target = k; p.state = 'mine'; p.t = 0; }
            }
          } else {
            const r = rocks[p.target];
            if (!r) { p.state = 'drift'; continue; }
            // settle next to the rock
            const tx = r.x - 9, ty = r.y + 1;
            p.x += (tx - p.x) * Math.min(1, dt * 0.6);
            p.y += (ty - p.y) * Math.min(1, dt * 0.6);
            if (p.state === 'mine' && p.t > 8) { p.state = 'build'; p.t = 0; }
            if (p.state === 'mine') r.mass = Math.max(0, r.mass - dt * 0.05);
            if (p.state === 'build' && p.t > 10) {
              // a copy is born and drifts off; the parent moves on too
              if (probes.length < 6) {
                const a = rng() * Math.PI * 2;
                probes.push({ x: p.x, y: p.y + 3, vx: Math.cos(a) * 2 + 1, vy: Math.sin(a) * 0.8, state: 'drift', t: 0, target: -1, gen: p.gen + 1 });
              }
              p.state = 'drift'; p.t = 0; p.vx = 1.5 + rng(); p.vy = (rng() - 0.5) * 0.6;
              if (r.mass < 0.3) rocks[p.target] = newRock();
            }
          }
          // wrap around the edges
          if (p.x > cols + 10) p.x = -9;
          if (p.x < -10) p.x = cols + 9;
          if (p.y < 1) p.vy = Math.abs(p.vy);
          if (p.y > rows - 4) p.vy = -Math.abs(p.vy);
        }
      },
      render(grid, ctx) {
        const starAmt = ctx.params.stars;
        for (let i = 0; i < sx.length * starAmt; i++) {
          grid.max(sx[i], sy[i], 0.08 + sd[i] * 0.35, 0.85, 0.88, 1, sd[i] > 0.9 ? 43 : 46);
        }
        for (const r of rocks) {
          const b = 0.25 + 0.25 * r.mass;
          ROCK.forEach((line, k) => grid.text(r.x, r.y + k, line, b, 0.75, 0.68, 0.6));
        }
        for (const p of probes) {
          const glow = p.state === 'build' ? 0.85 : 0.7;
          PROBE.forEach((line, k) => grid.text(p.x, p.y + k, line, glow, 0.85, 0.92, 1));
          // thruster glow when drifting, a little sparkle of work when mining or building
          if (p.state === 'drift') {
            const f = 0.35 + 0.25 * Math.sin(t * 3 + p.gen);
            grid.text(p.x - 2, p.y + 1, '~', clamp(f), 0.6, 0.8, 1);
          } else {
            const phase = Math.floor(p.t * 2) % 3;
            const dots = p.state === 'mine' ? ['.  ', '.. ', '...'][phase] : ['[  ]', '[= ]', '[==]'][phase];
            grid.text(p.x + 7, p.y + 1, dots, 0.6, 1, 0.85, 0.5);
            if (p.state === 'build') grid.text(p.x, p.y + 3, ` gen ${p.gen + 1}`, 0.35, 0.7, 0.8, 0.9);
          }
        }
      },
    };
  },
};

export default probe;
