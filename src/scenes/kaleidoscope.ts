import { clamp, hsv, smoothstep, TAU, type RGB } from '../engine/math';
import { hash2, type Rng } from '../engine/rng';
import type { SceneDef } from '../engine/types';
import { cp } from './kit';

const MAX_PIECES = 40;
// Jewel tones of old glass: ruby, cobalt, emerald, amber, amethyst, and a little clear glass.
const HUES = [0.98, 0.62, 0.36, 0.11, 0.8, 0.55, 0.02, 0.68];

/**
 * A stained glass rose window seen through a kaleidoscope. Pieces of jewel-colored glass
 * (a Voronoi mosaic bounded by dark lead lines) tumble slowly inside one wedge, which mirrors
 * into an N-fold rosette. Sunlight drifts across the window, and the whole thing turns.
 */
const kaleidoscope: SceneDef = {
  id: 'kaleidoscope',
  name: 'Stained Glass',
  family: 'procedural',
  blurb: 'A kaleidoscope of tumbling jewel-colored glass',
  recommended: { style: 'deep-field' },
  defaultSeed: 1248,
  params: [
    { key: 'segments', label: 'Mirrors', min: 3, max: 12, default: 8, step: 1 },
    { key: 'pieces', label: 'Pieces', min: 6, max: 40, default: 12, step: 1 },
    { key: 'speed', label: 'Tumble', min: 0, max: 2, default: 0.6 },
    { key: 'sun', label: 'Sunlight', min: 0, max: 1, default: 0.6 },
  ],
  create() {
    let cols = 0, rows = 0, aspect = 0.6, t = 0, spin = 0, spinV = 0;
    let rng!: Rng;
    // pieces live in a unit wedge domain (r in 0..1, a in 0..1 of the wedge)
    const pr = new Float32Array(MAX_PIECES), pa = new Float32Array(MAX_PIECES);
    const vr = new Float32Array(MAX_PIECES), va = new Float32Array(MAX_PIECES);
    const hue = new Float32Array(MAX_PIECES), sat = new Float32Array(MAX_PIECES);
    const tr = new Float32Array(MAX_PIECES), ta = new Float32Array(MAX_PIECES); // tumble targets
    const px = new Float32Array(MAX_PIECES), py = new Float32Array(MAX_PIECES);
    let tumble = -1;
    const rgb: RGB = [0, 0, 0];
    const pc = new Float32Array(MAX_PIECES * 3); // each pane's color

    const scatter = (into: [Float32Array, Float32Array]) => {
      for (let k = 0; k < MAX_PIECES; k++) {
        into[0][k] = Math.sqrt(rng()) * 0.95 + 0.03;
        into[1][k] = rng();
      }
    };

    return {
      init(ctx) {
        cols = ctx.cols; rows = ctx.rows; aspect = ctx.aspect; rng = ctx.rng;
        scatter([pr, pa]);
        for (let k = 0; k < MAX_PIECES; k++) {
          vr[k] = rng.range(-1, 1); va[k] = rng.range(-1, 1);
          const h = rng.pick(HUES);
          hue[k] = h + rng.range(-0.025, 0.025);
          sat[k] = h === 0.55 ? 0.45 : rng.range(0.65, 0.95); // a few paler, lightly tinted panes
          hsv(hue[k], sat[k], 1, rgb);
          pc[k * 3] = rgb[0]; pc[k * 3 + 1] = rgb[1]; pc[k * 3 + 2] = rgb[2];
        }
        t = rng() * 100;
        spin = rng() * TAU;
        tumble = -1;
      },
      update(dt, audio, ctx) {
        t += dt;
        const sp = ctx.params.speed;
        spinV += (audio.beat * 0.15 - spinV) * Math.min(1, dt * 0.8);
        spin += dt * (0.02 * sp + spinV);
        if (tumble >= 0) {
          // the turn: every piece glides to a new place
          tumble += dt / 9;
          const k = smoothstep(0, 1, Math.min(1, tumble));
          for (let i = 0; i < MAX_PIECES; i++) {
            pr[i] += (tr[i] - pr[i]) * k * dt * 2;
            pa[i] += (ta[i] - pa[i]) * k * dt * 2;
          }
          if (tumble >= 1) tumble = -1;
        }
        // pieces drift and bounce gently inside the wedge, like loose glass in the tube
        for (let i = 0; i < MAX_PIECES; i++) {
          const n = ctx.noise.n2(i * 3.1, t * 0.05);
          vr[i] += n * dt * 0.3; va[i] += ctx.noise.n2(i * 1.7 + 9, t * 0.05) * dt * 0.3;
          vr[i] *= 1 - dt * 0.2; va[i] *= 1 - dt * 0.2;
          pr[i] += vr[i] * dt * 0.02 * sp;
          pa[i] += va[i] * dt * 0.03 * sp;
          if (pr[i] < 0.03 || pr[i] > 0.98) { vr[i] = -vr[i]; pr[i] = clamp(pr[i], 0.03, 0.98); }
          if (pa[i] < 0 || pa[i] > 1) { va[i] = -va[i]; pa[i] = clamp(pa[i], 0, 1); }
        }
      },
      event() {
        tumble = 0;
        scatter([tr, ta]);
      },
      render(grid, ctx) {
        const V = grid.v, C = grid.col, G = grid.glyph;
        const N = Math.round(ctx.params.segments);
        const wedge = Math.PI / N; // half of one mirror segment
        const nP = Math.round(ctx.params.pieces);
        const cx = cols / 2, cy = rows / 2;
        const R = Math.min(cols * aspect, rows) * 0.48;
        const sun = ctx.params.sun;
        // sunlight: a broad warm patch drifting slowly across the window
        const sunX = Math.cos(t * 0.013) * 0.6, sunY = Math.sin(t * 0.009) * 0.5 - 0.2;
        // piece positions in the folded plane, computed once per frame
        for (let k = 0; k < nP; k++) {
          const a = pa[k] * wedge;
          px[k] = Math.cos(a) * pr[k];
          py[k] = Math.sin(a) * pr[k];
        }
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const i = y * cols + x;
            const dx = ((x + 0.5 - cx) * aspect) / R, dy = (y + 0.5 - cy) / R;
            const r = Math.hypot(dx, dy);
            if (r > 1.04) { V[i] = 0; G[i] = 0; continue; }
            if (r > 0.985) {
              // the iron ring around the window, studded with rivets
              const ang = Math.atan2(dy, dx);
              const rivet = Math.abs(((ang / TAU) * 64) % 1 - 0.5) < 0.12;
              V[i] = rivet ? 0.3 : 0.12; G[i] = cp(rivet ? 'o' : '='); C[i * 3] = 0.6; C[i * 3 + 1] = 0.6; C[i * 3 + 2] = 0.65;
              continue;
            }
            // fold the angle into one mirrored wedge
            let a = Math.atan2(dy, dx) - spin;
            a = ((a % (2 * wedge)) + 2 * wedge) % (2 * wedge);
            if (a > wedge) a = 2 * wedge - a;
            const fx = Math.cos(a) * r, fy = Math.sin(a) * r;
            // nearest and second-nearest piece: the gap between them is the lead line
            let d1 = 1e9, d2 = 1e9, k1 = 0;
            for (let k = 0; k < nP; k++) {
              const ddx = fx - px[k], ddy = fy - py[k];
              const d = ddx * ddx + ddy * ddy;
              if (d < d1) { d2 = d1; d1 = d; k1 = k; }
              else if (d < d2) d2 = d;
            }
            const edge = Math.sqrt(d2) - Math.sqrt(d1);
            const leadW = 0.012 + 0.008 * r;
            if (edge < leadW) {
              V[i] = 0.03; G[i] = 0; C[i * 3] = 0.3; C[i * 3 + 1] = 0.3; C[i * 3 + 2] = 0.3;
              continue;
            }
            // light through the glass: brighter toward each pane's center, warmed where the sun falls
            const inner = smoothstep(leadW, leadW + 0.12, edge);
            const sunLight = Math.exp(-(((dx - sunX) ** 2 + (dy - sunY) ** 2) / 0.35)) * sun;
            const seedy = (hash2(x, y, 3) - 0.5) * 0.08; // bubbles and ripples in old glass
            const v = clamp(0.5 + 0.25 * inner + 0.3 * sunLight + seedy);
            V[i] = v;
            G[i] = 0;
            // sunlight warms the glass toward pale gold
            const k3 = k1 * 3, w = sunLight * 0.35;
            C[i * 3] = pc[k3] + (1 - pc[k3]) * w; C[i * 3 + 1] = pc[k3 + 1] + (0.9 - pc[k3 + 1]) * w; C[i * 3 + 2] = pc[k3 + 2] + (0.6 - pc[k3 + 2]) * w;
          }
        }
        // a small rosette boss at the very center
        grid.set(cx, cy, 0.7, 1, 0.85, 0.5, cp('@'));
      },
    };
  },
};

export default kaleidoscope;
