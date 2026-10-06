import { LowResFieldN } from '../engine/field';
import type { Grid } from '../engine/grid';
import { clamp, smoothstep } from '../engine/math';
import type { Rng } from '../engine/rng';
import type { SceneDef } from '../engine/types';
import { cp } from './kit';

const MAX_STARS = 900;
const SPIKE_H = cp('-'), SPIKE_V = cp('|');

/**
 * Drifting through an emission nebula: glowing hydrogen (red) and oxygen (teal) gas, dark dust
 * lanes and pillars whose upper edges blaze where starlight erodes them, stars at different
 * depths sliding past with parallax, and young blue-white stars with diffraction spikes.
 * Rarely, a star goes supernova: a slow swell of light, then an expanding echo.
 */
const nebula: SceneDef = {
  id: 'nebula',
  name: 'Deep-Space Nebula',
  family: 'procedural',
  blurb: 'Drifting through glowing gas, dust pillars and young stars',
  recommended: { style: 'deep-field' },
  defaultSeed: 6611,
  params: [
    { key: 'drift', label: 'Drift', min: 0, max: 2, default: 0.6 },
    { key: 'gas', label: 'Gas glow', min: 0.2, max: 1.5, default: 1 },
    { key: 'dust', label: 'Dust', min: 0, max: 1, default: 0.6 },
    { key: 'stars', label: 'Stars', min: 0, max: 1, default: 0.6 },
  ],
  create() {
    let cols = 0, rows = 0, aspect = 0.6, t = 0;
    let camX = 0, camY = 0, zoom = 1;
    let rng!: Rng;
    // channels: hydrogen, oxygen, sulfur, dust, rim light
    const field = new LowResFieldN(5, 3, 4);
    const cell = new Float32Array(5);
    const sx = new Float32Array(MAX_STARS), sy = new Float32Array(MAX_STARS), sd = new Float32Array(MAX_STARS);
    const sm = new Float32Array(MAX_STARS), st = new Float32Array(MAX_STARS);
    let nStars = 0, worldW = 1, worldH = 1;
    let sn = -1, snX = 0, snY = 0;

    return {
      init(ctx) {
        cols = ctx.cols; rows = ctx.rows; aspect = ctx.aspect; rng = ctx.rng;
        worldW = cols * aspect * 1.6; worldH = rows * 1.6;
        nStars = Math.min(MAX_STARS, Math.floor((cols * rows) / 18));
        for (let k = 0; k < nStars; k++) {
          sx[k] = rng() * worldW; sy[k] = rng() * worldH;
          sd[k] = rng.range(0.25, 1); // parallax depth: 1 = near, moves with the camera
          sm[k] = Math.pow(rng(), 6);
          st[k] = rng();
        }
        camX = rng() * 1000; camY = 0;
        t = rng() * 100;
        sn = -1;
      },
      update(dt, _audio, ctx) {
        t += dt;
        camX += dt * ctx.params.drift * 0.5;
        camY = Math.sin(t * 0.006) * rows * 0.15;
        zoom = 1 + 0.12 * Math.sin(t * 0.0035);
        if (sn >= 0) {
          sn += dt;
          if (sn > 120) sn = -1;
        }
      },
      event() {
        sn = 0;
        snX = cols * rng.range(0.3, 0.7);
        snY = rows * rng.range(0.25, 0.6);
      },
      render(grid, ctx) {
        const { noise } = ctx;
        const V = grid.v, C = grid.col;
        const gas = ctx.params.gas, dustAmt = ctx.params.dust;
        const cx = cols / 2, cy = rows / 2;
        // world coordinates of a screen cell (square units)
        const wu = (x: number) => ((x - cx) * aspect) * zoom + camX;
        const wv = (y: number) => (y - cy) * zoom + camY;
        field.update(cols, rows, (x, y, out, o) => {
          const u = wu(x) * 0.012, v = wv(y) * 0.012;
          // domain warp makes the gas billow
          const qx = noise.n3(u * 0.7, v * 0.7, t * 0.002) * 1.2, qy = noise.n3(u * 0.7 + 30, v * 0.7, t * 0.002) * 1.2;
          const ha = noise.fbm3(u + qx, v + qy, 0.5 + t * 0.001, 4);
          const oiii = noise.fbm3(u * 1.4 + qy, v * 1.4 - qx, 9 + t * 0.0015, 3);
          // dust: lanes everywhere, plus pillars rising from below
          const lane = 1 - Math.abs(noise.fbm3(u * 1.3 + 40, v * 1.3, 2, 4)) * 2.2;
          const vy = (y - cy) / rows; // pillars live in the lower part of the view
          const col = Math.abs(Math.sin(u * 2.4 + noise.n2(u * 1.5, v * 0.6) * 1.6));
          const pillar = smoothstep(0.6, 0.9, col) * smoothstep(-0.25, 0.25, vy + noise.n2(u * 3, 5) * 0.3);
          const dust = clamp(Math.max(lane * 0.7, pillar) * (0.6 + 0.4 * noise.fbm3(u * 3, v * 3, 4, 3)));
          // rim light: the edge of the dust facing up toward the stars that light it
          const above = clamp(Math.max(lane * 0.7, smoothstep(0.6, 0.9, col) * smoothstep(-0.25, 0.25, vy - 0.04 + noise.n2(u * 3, 5) * 0.3)));
          // fine bright filaments threading the clouds
          const fil = smoothstep(0.55, 0.95, 1 - Math.abs(noise.n3(u * 2.2 + qx, v * 2.2 + qy, 3)) * 2);
          out[o] = clamp((0.12 + ha * 1.7) * (0.55 + 0.75 * fil));
          out[o + 1] = clamp(0.05 + oiii * 1.6) * smoothstep(0.6, -0.3, vy); // oxygen glows higher up, nearer the stars
          out[o + 2] = clamp(ha * 1.5 - 0.1); // sulfur in the densest filaments
          out[o + 3] = dust;
          out[o + 4] = clamp((dust - above * 0.6) * 2.2) * smoothstep(0.2, 0.6, dust);
        });
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            field.sample(x, y, cell);
            const ha = cell[0] ** 2, oiii = cell[1] ** 2, sii = cell[2], dust = cell[3] * dustAmt, rim = cell[4] * dustAmt;
            let r = ha * 1 + oiii * 0.15 + sii * 0.5;
            let g = ha * 0.22 + oiii * 0.85 + sii * 0.3;
            let b = ha * 0.45 + oiii * 0.8 + sii * 0.1;
            const absorb = 1 - dust * 0.9;
            r *= absorb; g *= absorb; b *= absorb;
            r += rim * 1.1; g += rim * 0.8; b += rim * 0.6;
            const lum = Math.max(r, g, b);
            const i = y * cols + x;
            V[i] = clamp((1 - Math.exp(-lum * 1.3)) * 0.85 * gas);
            const c = i * 3;
            const m = lum || 1;
            C[c] = r / m; C[c + 1] = g / m; C[c + 2] = b / m;
          }
        }
        // stars, with parallax; the brightest get diffraction spikes
        const starAmt = ctx.params.stars;
        const count = Math.round(nStars * starAmt);
        for (let k = 0; k < count; k++) {
          const px = (((sx[k] - camX * sd[k]) % worldW) + worldW) % worldW;
          const py = (((sy[k] - camY * sd[k]) % worldH) + worldH) % worldH;
          const x = cx + (px - worldW / 2) / aspect / zoom, y = cy + (py - worldH / 2) / zoom;
          if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
          const m = sm[k];
          const tw = 0.9 + 0.1 * Math.sin(t * 0.8 + k);
          const b = clamp((0.25 + 0.75 * m) * tw * (0.5 + 0.5 * sd[k]));
          // hot young stars run blue-white, cooler ones warm
          const blue = st[k] > 0.6;
          const cr = blue ? 0.8 : 1, cg = blue ? 0.9 : 0.9, cb = blue ? 1 : 0.75;
          grid.max(x, y, b, cr, cg, cb, cp(m > 0.5 ? '*' : m > 0.15 ? '+' : '.'));
          if (m > 0.35) drawSpikes(grid, x, y, b, Math.round(2 + m * 6), cr, cg, cb, aspect);
        }
        // supernova: a slow swell (no flash), then a light echo expanding through the gas
        if (sn >= 0) {
          const swell = (ctx.reducedMotion ? 0.5 : 1) * smoothstep(0, 6, sn) * (1 - smoothstep(20, 110, sn));
          grid.max(snX, snY, clamp(0.4 + swell), 1, 0.95, 0.9, cp('@'));
          drawSpikes(grid, snX, snY, clamp(swell), Math.round(4 + swell * rows * 0.25), 1, 0.92, 0.85, aspect);
          const R = sn * rows * 0.006 + 1;
          const ringFade = smoothstep(4, 12, sn) * (1 - smoothstep(60, 120, sn));
          for (let a = 0; a < Math.PI * 2; a += 0.6 / R) {
            const x = snX + (Math.cos(a) * R) / aspect, y = snY + Math.sin(a) * R;
            if (!grid.inside(x, y)) continue;
            const i = (y | 0) * cols + (x | 0);
            grid.add(x, y, 0.35 * ringFade * (0.5 + V[i]), 0.6, 0.9, 1);
          }
        }
      },
    };
  },
};

/** Four-point diffraction spikes, fading toward their tips. */
function drawSpikes(grid: Grid, x: number, y: number, b: number, len: number, r: number, g: number, bl: number, aspect: number) {
  for (let k = 1; k <= len; k++) {
    const f = 1 - k / (len + 1);
    const v = b * f * f * 0.8;
    if (v < 0.04) break;
    const kx = Math.round(k / aspect / 1.4);
    grid.max(x + kx, y, v, r, g, bl, SPIKE_H);
    grid.max(x - kx, y, v, r, g, bl, SPIKE_H);
    grid.max(x, y + k * 0.6, v, r, g, bl, SPIKE_V);
    grid.max(x, y - k * 0.6, v, r, g, bl, SPIKE_V);
  }
}

export default nebula;
