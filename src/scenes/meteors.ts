import { LowResField } from '../engine/field';
import { clamp, smoothstep } from '../engine/math';
import type { Rng } from '../engine/rng';
import type { SceneContext, SceneDef } from '../engine/types';
import { cp, Meteors, StarField } from './kit';

interface Satellite { x: number; y: number; vx: number; vy: number; age: number; fadeAt: number; flare: number }

/**
 * A dark-sky night during a meteor shower: a slowly turning sky, the Milky Way with dark dust
 * lanes, faint green airglow on the horizon, meteors streaming from a radiant (now and then a
 * green fireball that leaves a glowing train), and satellites that slide into Earth's shadow.
 */
const meteors: SceneDef = {
  id: 'meteors',
  name: 'Meteor Shower',
  family: 'particle',
  blurb: 'Meteors from a radiant across a turning, Milky Way sky',
  recommended: { style: 'midnight' },
  defaultSeed: 812,
  params: [
    { key: 'rate', label: 'Meteors/min', min: 1, max: 40, default: 10, step: 1 },
    { key: 'rotation', label: 'Sky rotation', min: 0, max: 1, default: 0.3 },
    { key: 'milkyway', label: 'Milky Way', min: 0, max: 1, default: 0.7 },
    { key: 'satellites', label: 'Satellites', min: 0, max: 1, default: 0.5 },
  ],
  create() {
    let cols = 0, rows = 0, t = 0, rot = 0;
    let rng!: Rng;
    const stars = new StarField();
    const bandStars = new StarField(); // a dense, faint layer that traces the Milky Way
    let noise!: SceneContext['noise'];
    let aspect = 0.6;
    const shower = new Meteors(48);
    const band = new LowResField(2, 8);
    let horizon = new Float32Array(0);
    let poleX = 0, poleY = 0, radR = 0, radA = 0;
    let sats: Satellite[] = [];
    let outburst = 0, sinceBeat = 10;

    // The radiant turns with the sky, so it is stored in polar form around the pole.
    const radiant = (aspect: number): [number, number] => [poleX + (Math.cos(radA + rot) * radR) / aspect, poleY + Math.sin(radA + rot) * radR];
    /** Milky Way brightness at a screen cell for a given sky rotation (0..1). */
    const bandAt = (x: number, y: number, r: number) => {
      const cosR = Math.cos(r), sinR = Math.sin(r);
      const px = (x - poleX) * aspect, py = y - poleY;
      const sx = px * cosR + py * sinR, sy = -px * sinR + py * cosR;
      const across = sy * 0.8 - sx * 0.55 - rows * 0.45;
      const w = rows * 0.2;
      const core = Math.exp(-(across * across) / (w * w));
      const clumps = 0.5 + 0.5 * noise.fbm2(sx * 0.03, sy * 0.03, 4);
      // dark dust lanes along the band's spine
      const rift = Math.exp(-((across + w * 0.15) ** 2) / ((w * 0.18) ** 2)) * clamp(0.4 + noise.fbm2(sx * 0.05 + 9, sy * 0.05, 3));
      return clamp(core * clumps - rift * 0.75);
    };
    const groundAt = (x: number) => horizon[Math.max(0, Math.min(cols - 1, x | 0))];

    const launch = (aspect: number, fireball = false) => {
      const [rx, ry] = radiant(aspect);
      // start somewhere in the sky, travel directly away from the radiant
      let sx = 0, sy = 0, dx = 0, dy = 0, dist = 0;
      // fireballs start well away from the radiant so they draw a long arc
      for (let k = 0; k < (fireball ? 12 : 1); k++) {
        sx = rng() * cols; sy = rng() * rows * 0.7;
        dx = (sx - rx) * aspect; dy = sy - ry;
        dist = Math.hypot(dx, dy) || 1;
        if (dist > rows * 0.55) break;
      }
      dx /= dist; dy /= dist;
      // meteors near the radiant are foreshortened: short and slow
      const fore = clamp(dist / (rows * 0.7), 0.25, 1);
      const speed = rng.range(28, 55) * fore * (fireball ? 0.5 : 1);
      const bright = fireball ? 1 : 0.35 + 0.6 * Math.pow(rng(), 3);
      shower.spawn({
        x: sx, y: sy,
        vx: (dx * speed) / aspect, vy: dy * speed,
        life: (fireball ? rng.range(1.6, 2.4) : rng.range(0.35, 0.9)) * (0.6 + 0.4 * fore),
        bright,
        tail: fireball ? 0.35 : 0.22,
        head: fireball ? [0.75, 1, 0.8] : [1, 1, 0.95],
        color: fireball ? [1, 0.7, 0.4] : bright > 0.8 ? [0.85, 0.95, 1] : [0.8, 0.85, 1],
        train: fireball ? 1 : bright > 0.85 ? 0.35 : 0,
      });
    };

    return {
      init(ctx) {
        cols = ctx.cols; rows = ctx.rows; rng = ctx.rng; noise = ctx.noise; aspect = ctx.aspect;
        horizon = new Float32Array(cols);
        // a ragged treeline of pines along a low ridge
        for (let x = 0; x < cols; x++) {
          const u = x * ctx.aspect;
          let h = rows * (0.9 - 0.04 * ctx.noise.fbm2(u * 0.015, 2.5, 3));
          const p = ctx.noise.n2(u * 0.25, 9);
          if (p > 0.05) h -= (p - 0.05) * rows * 0.12 * (0.6 + 0.4 * Math.abs(Math.sin(u * 1.3)));
          horizon[x] = h;
        }
        poleX = cols * rng.range(0.6, 0.9);
        poleY = -rows * rng.range(0.15, 0.45);
        stars.init(rng, cols, rows, ctx.aspect, { density: 0.025, pole: [poleX, poleY] });
        bandStars.init(rng, cols, rows, ctx.aspect, { density: 0.055, magScale: 0.3, pole: [poleX, poleY], accept: (x, y) => bandAt(x, y, 0) ** 1.5 });
        // radiant: up in the sky, not too close to the edge
        const rx = cols * rng.range(0.25, 0.7), ry = rows * rng.range(0.12, 0.3);
        radR = Math.hypot((rx - poleX) * ctx.aspect, ry - poleY);
        radA = Math.atan2(ry - poleY, (rx - poleX) * ctx.aspect);
        rot = 0;
        sats = [];
        shower.clear();
        t = rng() * 100;
      },
      update(dt, audio, ctx) {
        t += dt;
        rot += dt * ctx.params.rotation * 0.0025;
        shower.update(dt);
        let rate = ctx.params.rate / 60;
        if (outburst > 0) {
          outburst -= dt;
          // ramps up over 4 s, eases off over the last 8 s
          rate *= 1 + 7 * smoothstep(0, 4, 30 - outburst) * smoothstep(0, 8, outburst);
        }
        if (rng() < rate * dt) launch(ctx.aspect, rng() < 0.025);
        sinceBeat += dt;
        if (audio.beat > 0.8 && sinceBeat > 1.5) {
          sinceBeat = 0;
          launch(ctx.aspect);
        }
        // satellites: steady dots on slow straight paths that fade into Earth's shadow
        if (rng() < dt * ctx.params.satellites / 60 && sats.length < 3) {
          const fromLeft = rng() < 0.5;
          const sp = cols / rng.range(35, 70);
          sats.push({
            x: fromLeft ? -1 : cols + 1, y: rows * rng.range(0.1, 0.55),
            vx: (fromLeft ? 1 : -1) * sp, vy: sp * rng.range(-0.15, 0.25) * ctx.aspect,
            age: 0, fadeAt: rng.range(0.4, 1.2) * cols / sp, flare: rng() < 0.15 ? rng.range(5, 20) : -1,
          });
        }
        for (const s of sats) {
          s.age += dt;
          s.x += s.vx * dt;
          s.y += s.vy * dt;
        }
        sats = sats.filter((s) => s.x > -3 && s.x < cols + 3 && s.age < s.fadeAt + 8);
      },
      event(ctx) {
        // An outburst: half a minute of many meteors, opened by a fireball.
        outburst = 30;
        launch(ctx.aspect, true);
      },
      render(grid, ctx) {
        const V = grid.v, C = grid.col;
        const mw = ctx.params.milkyway;
        // Sky: deep blue, airglow near the horizon, the Milky Way across it all.
        if (mw > 0) band.update(cols, rows, (x, y) => bandAt(x, y, rot));
        for (let x = 0; x < cols; x++) {
          const gy = groundAt(x);
          for (let y = 0; y < gy && y < rows; y++) {
            const i = y * cols + x;
            const c = i * 3;
            const low = clamp(1 - (gy - y) / (rows * 0.25));
            let v = 0.012 + 0.03 * low * low;
            let r = 0.3, g = 0.4, b = 0.85;
            const air = low * low * 0.045; // airglow
            if (air > 0.005) { v += air; r = 0.4; g = 0.85; b = 0.55; }
            if (mw > 0) {
              const m = band.sample(x, y) * mw * (1 - low * 0.6);
              if (m > 0.02) {
                v += m * 0.09;
                const w = m / (v + 1e-3);
                r += (0.85 - r) * w; g += (0.82 - g) * w; b += (0.95 - b) * w;
              }
            }
            V[i] = v;
            C[c] = r; C[c + 1] = g; C[c + 2] = b;
          }
        }
        const occluded = (x: number, y: number) => y >= groundAt(x) - 0.5;
        if (mw > 0) bandStars.render(grid, t, aspect, rot, { occluded, brightness: 0.5 + 0.5 * mw });
        stars.render(grid, t, aspect, rot, { occluded });
        shower.render(grid, aspect);
        for (const s of sats) {
          const fade = 1 - smoothstep(s.fadeAt, s.fadeAt + 6, s.age);
          // a rare "flare": the satellite's panels catch the sun, swelling then fading over seconds
          const flare = s.flare > 0 ? Math.exp(-(((s.age - s.flare) / 2.2) ** 2)) : 0;
          grid.max(s.x, s.y, clamp((0.38 + flare * 0.6) * fade), 1, 1, 0.95, cp(flare > 0.4 ? '*' : '·'));
        }
        // Treeline silhouette
        for (let x = 0; x < cols; x++) {
          const gy = Math.floor(groundAt(x));
          for (let y = Math.max(0, gy); y < rows; y++) {
            const i = y * cols + x;
            V[i] = 0;
            grid.glyph[i] = 0;
          }
        }
      },
    };
  },
};

export default meteors;
