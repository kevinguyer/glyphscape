import { LowResField } from '../engine/field';
import type { Grid } from '../engine/grid';
import { clamp, fexp, smoothstep } from '../engine/math';
import type { Noise } from '../engine/noise';
import { hash2, type Rng } from '../engine/rng';
import type { SceneDef } from '../engine/types';
import { cp, StarField } from './kit';

// Life of one wave, in wave periods: approach from the horizon, break, bore, swash, foam.
const APPROACH = 2.2, BREAK = 2.45, BORE = 2.9, SWASH = 3.6, FOAM_END = 4.3;
const WAVES = 5; // waves alive per column at once
const BREAK_S = 0.6; // break line, as a fraction of the way from horizon to shore

const TILDE = cp('~'), DOT = cp('.'), COMMA = cp(',');

/**
 * Surf on a moonlit beach, seen from the dunes. Swells roll in with perspective and peel along
 * the shore as they break; whitewater bores rush up the sand and drain back, leaving wet sand
 * that mirrors the moon. A lighthouse on the headland sweeps its beam. Rarely, the tide glows.
 */
const ocean: SceneDef = {
  id: 'ocean',
  name: 'Moonlit Surf',
  family: 'scenic',
  blurb: 'Swells peel and break on a moonlit beach',
  recommended: { style: 'midnight' },
  defaultSeed: 1851,
  params: [
    { key: 'swell', label: 'Swell', min: 0.2, max: 1.5, default: 0.8 },
    { key: 'speed', label: 'Speed', min: 0.3, max: 2, default: 1 },
    { key: 'moon', label: 'Moonlight', min: 0, max: 1, default: 0.7 },
    { key: 'lighthouse', label: 'Lighthouse', min: 0, max: 1, default: 1, step: 1 },
  ],
  create() {
    let cols = 0, rows = 0, n = 0, aspect = 0.6;
    let t = 0, phase = 0, swellAmp = 1, sparkle = 0;
    let rng!: Rng;
    let noise!: Noise;
    let yH = 0, moonX = 0, moonY = 0, side = 1;
    let shore = new Float32Array(0), land = new Float32Array(0), off = new Float32Array(0), wet = new Float32Array(0);
    let lampX = 0, lampY = 0, towerH = 0;
    let bio = -1;
    const stars = new StarField();
    const clouds = new LowResField(3, 6);
    const rippleF = new LowResField(2, 2);
    // per-column wave state, reused every tick
    let wa = new Float32Array(0), wamp = new Float32Array(0);

    /** Height of wave n: varies wave to wave and rises and falls in sets of about seven. */
    const amp = (wn: number) => clamp(0.55 + 0.3 * hash2(wn, 7, 3) + 0.35 * Math.sin((wn * Math.PI * 2) / 7), 0.2, 1.3);

    return {
      init(ctx) {
        cols = ctx.cols; rows = ctx.rows; n = cols * rows; aspect = ctx.aspect;
        rng = ctx.rng; noise = ctx.noise;
        yH = Math.round(rows * 0.33);
        side = rng() < 0.5 ? -1 : 1;
        moonX = cols * (side < 0 ? rng.range(0.55, 0.8) : rng.range(0.2, 0.45));
        moonY = rows * rng.range(0.1, 0.2);
        shore = new Float32Array(cols); land = new Float32Array(cols); off = new Float32Array(cols);
        wet = new Float32Array(n);
        wa = new Float32Array(cols * WAVES); wamp = new Float32Array(cols * WAVES);
        for (let x = 0; x < cols; x++) {
          const u = x * aspect;
          shore[x] = rows * (0.75 + 0.035 * noise.fbm2(u * 0.012, 5.5, 3));
          // swells arrive at an angle, so breakers peel along the beach
          off[x] = (x / cols) * 0.45 * side + 0.08 * noise.n2(u * 0.02, 3.3);
          // headland on one side, rising toward the edge of the screen
          const fromEdge = side < 0 ? x / (cols * 0.2) : (cols - 1 - x) / (cols * 0.2);
          land[x] = fromEdge < 1
            ? yH - rows * (0.09 * (1 - Math.pow(fromEdge, 1.6)) + 0.01 * noise.n2(u * 0.2, 8)) + (fromEdge > 0.85 ? (fromEdge - 0.85) * rows * 0.6 : 0)
            : Infinity;
        }
        const lx = Math.round(side < 0 ? cols * 0.07 : cols * 0.93);
        towerH = Math.max(3, Math.round(rows * 0.07));
        lampX = lx;
        lampY = Math.floor(land[lx]) - towerH;
        stars.init(rng, cols, rows, aspect, { density: 0.014, maxY: (yH - 1) / rows });
        t = rng() * 100;
        phase = rng() * 50;
        bio = -1;
      },
      update(dt, audio, ctx) {
        t += dt;
        phase += (dt * ctx.params.speed) / 9; // a wave every ~9 s at speed 1
        const target = ctx.params.swell * (1 + audio.bands[0] * 0.4);
        swellAmp += (target - swellAmp) * Math.min(1, dt * 0.5);
        sparkle = Math.max(sparkle * Math.exp(-dt * 2), audio.beat);
        const dry = Math.exp(-dt / 9);
        for (let i = 0; i < n; i++) wet[i] *= dry;
        if (bio >= 0) {
          bio += dt;
          if (bio > 150) bio = -1;
        }
      },
      event() {
        bio = 0; // a bioluminescent tide for a couple of minutes
      },
      render(grid, ctx) {
        const V = grid.v, C = grid.col, G = grid.glyph;
        const moon = ctx.params.moon;
        const bioAmt = bio >= 0 ? smoothstep(0, 12, bio) * smoothstep(150, 135, bio) : 0;
        const fr = 0.9 - 0.6 * bioAmt, fg = 0.95, fb = 1; // foam color, cyan when glowing
        const foamBoost = 0.12 * bioAmt + sparkle * 0.1;

        // --- sky ---------------------------------------------------------------
        clouds.update(cols, rows, (x, y) => (y > yH ? 0 : smoothstep(0.1, 0.65, noise.fbm2(x * aspect * 0.012 - t * 0.004, y * 0.09, 4))));
        const mr = Math.max(1.4, rows * 0.04);
        for (let y = 0; y < yH; y++) {
          for (let x = 0; x < cols; x++) {
            const i = y * cols + x;
            const dx = (x - moonX) * aspect, dy = y - moonY;
            const md = Math.sqrt(dx * dx + dy * dy) / mr;
            const halo = fexp(-md * 0.55) * 0.18 * (0.4 + moon);
            const near = fexp(-md * 0.12);
            let v = 0.012 + 0.06 * Math.pow(y / yH, 3) + halo + clouds.sample(x, y) * (0.02 + 0.24 * near * moon);
            if (md < 1) v = 0.75 + 0.2 * (1 - md); // the moon itself
            V[i] = clamp(v);
            const c = i * 3;
            C[c] = 0.55 + 0.4 * near; C[c + 1] = 0.62 + 0.33 * near; C[c + 2] = 0.9;
          }
        }
        stars.render(grid, t, aspect, 0, {
          horizon: yH,
          occluded: (x, y) => {
            const dx = (x - moonX) * aspect, dy = y - moonY;
            return dx * dx + dy * dy < mr * mr * 9 || y >= land[x | 0];
          },
        });

        // --- wave state per column ---------------------------------------------
        for (let x = 0; x < cols; x++) {
          const p = phase + off[x];
          const f = p - Math.floor(p);
          const wn = Math.floor(p);
          for (let k = 0; k < WAVES; k++) {
            wa[x * WAVES + k] = f + k;
            wamp[x * WAVES + k] = amp(wn - k) * swellAmp;
          }
        }

        // --- sea, surf and beach ----------------------------------------------
        rippleF.update(cols, rows, (x, y) => {
          if (y < yH) return 0;
          const s = (y - yH + 0.5) / (shore[Math.min(cols - 1, x)] - yH);
          const depth = 0.08 + s;
          return noise.n3((((x - moonX) * aspect) / depth) * 0.12, (1 / depth) * 1.6 - t * 0.25, t * 0.07);
        });
        const gladeW = (s: number) => cols * aspect * (0.02 + 0.11 * s);
        for (let x = 0; x < cols; x++) {
          const sh = shore[x];
          const span = sh - yH;
          const gx = (x - moonX) * aspect;
          for (let y = yH; y < rows; y++) {
            if (y >= land[x] && y < sh + 2) continue; // headland (drawn later); the beach runs beneath it
            const i = y * cols + x;
            const c = i * 3;
            let v: number, r: number, g: number, b: number;
            let glyph = 0;
            if (y < sh) {
              // open water, with perspective: s is 0 at the horizon, 1 at the shoreline
              const s = (y - yH + 0.5) / span;
              const depth = 0.08 + s;
              const X = gx / depth, Z = 1 / depth;
              const ripple = rippleF.sample(x, y);
              v = 0.012 + 0.02 * s + 0.018 * ripple;
              r = 0.22; g = 0.36; b = 0.68;
              // moon glade: a column of broken light that widens toward the viewer
              const gw = gladeW(s);
              const glade = fexp(-(gx * gx) / (gw * gw)) * moon;
              if (glade > 0.01) {
                const glit = smoothstep(0.05, 0.55, noise.n3(X * 0.5, Z * 5 + t * 0.4, t * 0.5) + ripple * 0.3);
                const add = glade * (0.08 + 0.55 * glit) * (0.55 + 0.45 * s);
                v += add;
                const w = add / (v + 1e-3);
                r += (0.85 - r) * w; g += (0.9 - g) * w; b += (1 - b) * w;
              }
              // incoming crests, breakers, bores and leftover foam
              // Whitewater has two textures: solid foam at the breaker and the bore front, and
              // thin lacy foam lines (ridged noise) trailing behind and drifting in the shallows.
              let solid = 0, laceAmt = 0;
              for (let k = 0; k < WAVES; k++) {
                const a = wa[x * WAVES + k];
                const A = wamp[x * WAVES + k];
                if (a < APPROACH) {
                  const sc = BREAK_S * Math.pow(a / APPROACH, 1.6);
                  const w = (0.35 + 2.2 * sc) / span; // crest thickness in s units
                  const dc = (s - sc) / w;
                  if (dc > -2.5 && dc < 2.5) {
                    const crest = fexp(-dc * dc) * A * (0.1 + 0.6 * sc);
                    v += crest;
                    // the dark face in front of the crest
                    if (dc > 0.8 && dc < 2.4) v -= 0.02 * A * sc;
                    if (crest > 0.08 && dc > -0.5 && dc < 0.6) glyph = TILDE;
                  }
                } else if (a < BREAK) {
                  // the lip pitches over: a band of whitewater that thickens as it breaks
                  const u = (a - APPROACH) / (BREAK - APPROACH);
                  const sc = BREAK_S + 0.04 * u;
                  const thick = (1 + 2.5 * A * u) / span;
                  const dd = (s - sc) / thick;
                  if (dd > -0.5 && dd < 1.2) solid = Math.max(solid, A * (0.75 + 0.35 * u));
                } else if (a < BORE) {
                  // the bore rushes shoreward: a bright front with a lacy wake
                  const u = (a - BREAK) / (BORE - BREAK);
                  const sf = BREAK_S + 0.04 + (1 - BREAK_S - 0.04) * u;
                  const behind = (sf - s) * span; // rows behind the front
                  if (behind > -0.6) {
                    if (behind < 1.5 + A) solid = Math.max(solid, A * (0.9 - 0.3 * u));
                    else if (s > BREAK_S - 0.02) laceAmt = Math.max(laceAmt, A * 0.75 * fexp(-behind / (rows * 0.08)));
                  }
                } else if (a < FOAM_END && s > BREAK_S - 0.03) {
                  // foam lines left behind, slowly fading in the shallows
                  const u = (a - BORE) / (FOAM_END - BORE);
                  laceAmt = Math.max(laceAmt, A * 0.5 * (1 - u * u));
                }
              }
              if (solid > 0.02 || laceAmt > 0.02) {
                const nn = noise.n3(x * aspect * 0.22, y * 0.5, t * 0.3);
                const ridge = smoothstep(0.55, 0.92, 1 - Math.abs(nn) * 2.6); // thin foam lines
                const blot = 0.65 + 0.35 * smoothstep(-0.4, 0.4, nn);
                const fv = clamp(Math.max(solid * blot, laceAmt * ridge) + foamBoost * ridge);
                if (fv > v) {
                  v = fv;
                  r = fr; g = fg; b = fb;
                  glyph = 0; // let foam use the ramp
                }
              }
              if (y === yH) v = Math.max(v, 0.07); // a faint horizon line
            } else {
              // the beach: dry moonlit sand, wet sand that mirrors the moon, and the swash
              const below = y - sh;
              const h = hash2(x, y, 21);
              v = 0.022 + 0.012 * h + 0.03 * (below / (rows - sh + 1));
              r = 0.85; g = 0.76; b = 0.58;
              glyph = h > 0.975 ? DOT : h > 0.96 ? COMMA : 0;
              for (let k = 0; k < WAVES; k++) {
                const a = wa[x * WAVES + k];
                if (a < BORE || a >= SWASH) continue;
                const A = wamp[x * WAVES + k];
                const u = (a - BORE) / (SWASH - BORE);
                const reach = rows * 0.11 * A * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.15)), 0.8);
                if (below < reach) {
                  wet[i] = 1;
                  // a thin sheet of water with a lacy front edge
                  const edge = reach - below;
                  const front = edge < 1.2 ? A * (0.55 - 0.3 * u) : 0;
                  const sheet = 0.1 + 0.05 * (1 - u);
                  const lace = smoothstep(-0.3, 0.4, noise.n3(x * aspect * 0.4, y * 0.8, t * 0.6));
                  const sv = Math.max(sheet, front * (0.4 + 0.6 * lace) + foamBoost * lace);
                  v = sv;
                  if (front > 0.1) { r = fr; g = fg; b = fb; glyph = lace > 0.5 ? TILDE : 0; }
                  else { r = 0.45; g = 0.58; b = 0.8; glyph = 0; }
                }
              }
              const w = wet[i];
              if (w > 0.03 && v < 0.2) {
                // wet sand is darker but catches the moon's reflection
                const gw = gladeW(1) * 0.7;
                const refl = fexp(-(gx * gx) / (gw * gw)) * moon * (0.12 + 0.2 * hash2(x, y, 4));
                v = v * (1 - 0.4 * w) + refl * w;
                r += (0.55 - r) * w * 0.6; g += (0.62 - g) * w * 0.6; b += (0.8 - b) * w * 0.6;
                if (w > 0.4) glyph = 0;
              }
            }
            V[i] = clamp(v);
            G[i] = glyph;
            C[c] = r; C[c + 1] = g; C[c + 2] = b;
          }
        }

        // --- headland and lighthouse ------------------------------------------
        for (let x = 0; x < cols; x++) {
          if (land[x] === Infinity) continue;
          const top = Math.max(0, Math.floor(land[x]));
          // the headland runs down to rocks at the top of the beach
          for (let y = top; y < Math.min(rows, shore[x] + 2); y++) {
            const i = y * cols + x;
            // dark rock with faint moonlit texture, and surf where the sea meets the cliff
            const h = hash2(x, y, 31);
            V[i] = y === top ? 0.07 : 0.01 + (h > 0.93 ? 0.05 : 0);
            G[i] = y === top ? cp('_') : h > 0.93 ? cp(h > 0.97 ? ':' : '.') : 0;
            C[i * 3] = 0.5; C[i * 3 + 1] = 0.55; C[i * 3 + 2] = 0.65;
          }
        }
        // foam surging against the foot of the cliff
        const cliffX = side < 0 ? cols * 0.2 : cols * 0.8;
        for (let y = yH + 1; y < rows; y++) {
          let x = Math.round(cliffX);
          while (x > 0 && x < cols - 1 && land[x] <= y) x -= side; // step out to the water's edge
          const k = Math.min(WAVES - 1, 2);
          const surge = wamp[x * WAVES + k] * (0.5 + 0.5 * Math.sin(phase * Math.PI * 2 + y * 0.3));
          const lace = smoothstep(-0.2, 0.5, noise.n3(x * 0.5, y * 0.6, t * 0.5));
          for (let d = 0; d < 2; d++) grid.max(x - side * d, y, clamp(surge * 0.35 * lace * (1 - d * 0.5)), fr, fg, fb);
        }
        if (ctx.params.lighthouse >= 0.5) drawLighthouse(grid, lampX, lampY, towerH, t, side, aspect);
      },
    };
  },
};

/** The lighthouse: a small tower whose lamp swells as it turns toward you and whose beam sweeps the sky. */
function drawLighthouse(grid: Grid, lx: number, ly: number, h: number, t: number, side: number, aspect: number) {
  const theta = (t * Math.PI * 2) / 14; // one turn every 14 s
  const toward = Math.max(0, Math.cos(theta));
  const sideways = Math.sin(theta);
  // tower
  for (let k = 1; k <= h; k++) {
    grid.set(lx - 1, ly + k, 0.14, 0.75, 0.75, 0.8, cp(k === h ? '/' : '|'));
    grid.set(lx + 1, ly + k, 0.14, 0.75, 0.75, 0.8, cp(k === h ? '\\' : '|'));
    grid.set(lx, ly + k, k % 2 ? 0.1 : 0.04, 0.9, 0.5, 0.45, cp(k % 2 ? '=' : ' '));
  }
  grid.set(lx - 1, ly, 0.2, 0.8, 0.8, 0.85, cp('['));
  grid.set(lx + 1, ly, 0.2, 0.8, 0.8, 0.85, cp(']'));
  // lamp: a slow swell as the light faces the viewer (about a second wide, never a flash)
  const lamp = 0.45 + 0.5 * Math.pow(toward, 6);
  grid.set(lx, ly, lamp, 1, 0.92, 0.7, cp('*'));
  grid.max(lx, ly - 1, 0.25 * Math.pow(toward, 4), 1, 0.9, 0.7);
  // beam: visible while it points across the scene (away from the headland)
  const dir = Math.sign(sideways);
  const strength = Math.abs(sideways);
  if (dir === -side && strength > 0.15) {
    const len = grid.cols * 1.1 * strength;
    for (let d = 2; d < len; d++) {
      const x = lx + dir * d;
      if (x < 0 || x >= grid.cols) break;
      const w = 0.5 + d * aspect * 0.05;
      const fall = Math.exp(-d / (grid.cols * 0.45)) * strength * strength;
      for (let dy = -Math.ceil(w * 2); dy <= Math.ceil(w * 2); dy++) {
        const b = 0.2 * fall * Math.exp(-(dy * dy) / (w * w));
        if (b > 0.012) grid.max(x, ly + dy + d * 0.02, b, 1, 0.92, 0.75);
      }
    }
  }
}

export default ocean;
