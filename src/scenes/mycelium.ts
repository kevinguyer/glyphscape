import { clamp, smoothstep } from '../engine/math';
import { hash2, type Rng } from '../engine/rng';
import type { SceneDef } from '../engine/types';
import { cp, lineGlyph, Motes } from './kit';

const EMPTY = 0, ROOT = 1, HYPHA = 2, ROCK = 3;
const ALIVE = 1, DYING = 2;
const MAX_TIPS = 140;
const PULSE_SPEED = 8; // cells per second

interface Pulse { dist: Int32Array; t0: number; maxD: number }
interface Mushroom { x: number; born: number; life: number; h: number; w: number; phase: number }

/**
 * The wood wide web: a cross-section of forest soil where fungal threads grow out from tree
 * roots, branch, and fuse into a network. Pulses of light (nutrients and signals) travel
 * through it from tree to tree, and where the threads reach the surface, glowing mushrooms
 * fruit and release drifting spores. Old threads die back so the web keeps renewing.
 */
const mycelium: SceneDef = {
  id: 'mycelium',
  name: 'Mycelium',
  family: 'simulation',
  blurb: 'A fungal network linking trees, carrying pulses of light',
  recommended: { style: 'midnight' },
  defaultSeed: 1997,
  params: [
    { key: 'growth', label: 'Growth', min: 0.2, max: 3, default: 1 },
    { key: 'branching', label: 'Branching', min: 0, max: 1, default: 0.5 },
    { key: 'pulses', label: 'Pulses', min: 0, max: 1, default: 0.5 },
    { key: 'glow', label: 'Glow', min: 0.2, max: 1.5, default: 1 },
  ],
  create() {
    let cols = 0, rows = 0, n = 0, aspect = 0.6, t = 0;
    let rng!: Rng;
    let yS = 0; // soil surface row
    let occ = new Uint8Array(0), state = new Uint8Array(0);
    let born = new Float32Array(0), dieAt = new Float32Array(0), glyph = new Uint32Array(0);
    let order = new Int32Array(0), qHead = 0, qTail = 0, alive = 0, cap = 0;
    let roots: number[] = [];
    let trees: number[] = [];
    // growing tips
    const tx = new Float32Array(MAX_TIPS), ty = new Float32Array(MAX_TIPS), ta = new Float32Array(MAX_TIPS), tp = new Float32Array(MAX_TIPS);
    const tAlive = new Uint8Array(MAX_TIPS);
    let tipCount = 0;
    let pulses: Pulse[] = [];
    let nextPulse = 3, sinceBeat = 10;
    let mushrooms: Mushroom[] = [];
    let burst = -1;
    const spores = new Motes();
    let bfsQueue = new Int32Array(0);

    const idx = (x: number, y: number) => y * cols + x;

    const addTip = (x: number, y: number, a: number) => {
      if (tipCount >= MAX_TIPS) return;
      for (let k = 0; k < MAX_TIPS; k++) {
        if (tAlive[k]) continue;
        tAlive[k] = 1; tx[k] = x; ty[k] = y; ta[k] = a; tp[k] = rng();
        tipCount++;
        return;
      }
    };

    const killTip = (k: number) => {
      tAlive[k] = 0;
      tipCount--;
    };

    /** Roots: branching random walks downward from each tree's base. */
    const growRoot = (x: number, y: number, a: number, len: number, depth: number) => {
      for (let s = 0; s < len; s++) {
        const nx = x + Math.cos(a) / aspect * 0.9, ny = y + Math.sin(a) * 0.9;
        const ix = Math.round(nx), iy = Math.round(ny);
        if (ix < 0 || ix >= cols || iy <= yS || iy >= rows - 1) return;
        const i = idx(ix, iy);
        if (occ[i] === EMPTY) {
          occ[i] = ROOT;
          glyph[i] = lineGlyph(nx - x, ny - y, aspect);
          roots.push(i);
        }
        x = nx; y = ny;
        a += (rng() - 0.5) * 0.35 + (Math.PI / 2 - a) * 0.04; // roots bend downward
      }
      if (depth < 3) {
        for (let k = 0; k < 2; k++) growRoot(x, y, a + (k ? 1 : -1) * rng.range(0.4, 0.9), Math.round(len * rng.range(0.5, 0.75)), depth + 1);
      }
    };

    const startPulse = (src: number) => {
      if (pulses.length >= 3) return;
      const dist = new Int32Array(n).fill(-1);
      let head = 0, tail = 0, maxD = 0;
      dist[src] = 0;
      bfsQueue[tail++] = src;
      while (head < tail) {
        const i = bfsQueue[head++];
        const x = i % cols, y = (i / cols) | 0;
        const d = dist[i] + 1;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= cols || yy >= rows) continue;
            const j = idx(xx, yy);
            if (dist[j] >= 0) continue;
            const o = occ[j];
            if (o === ROOT || (o === HYPHA && state[j] === ALIVE)) {
              dist[j] = d;
              if (d > maxD) maxD = d;
              bfsQueue[tail++] = j;
            }
          }
        }
      }
      pulses.push({ dist, t0: t, maxD });
    };

    const occupy = (i: number, g: number) => {
      occ[i] = HYPHA; state[i] = ALIVE; born[i] = t; glyph[i] = g;
      order[qTail] = i;
      qTail = (qTail + 1) % order.length;
      alive++;
    };

    return {
      init(ctx) {
        cols = ctx.cols; rows = ctx.rows; n = cols * rows; aspect = ctx.aspect; rng = ctx.rng;
        yS = Math.round(rows * 0.26);
        occ = new Uint8Array(n); state = new Uint8Array(n); born = new Float32Array(n); dieAt = new Float32Array(n);
        glyph = new Uint32Array(n); order = new Int32Array(n); bfsQueue = new Int32Array(n);
        qHead = qTail = alive = 0;
        cap = Math.floor((rows - yS) * cols * 0.2);
        tAlive.fill(0); tipCount = 0;
        roots = []; pulses = []; mushrooms = [];
        // stones in the soil
        for (let k = 0; k < (cols * rows) / 300; k++) {
          const sx = rng.int(0, cols), sy = rng.int(yS + 3, rows), r = rng.range(0.8, 2.2);
          for (let y = Math.floor(sy - r); y <= sy + r; y++) {
            for (let x = Math.floor(sx - r / aspect); x <= sx + r / aspect; x++) {
              if (x < 0 || y <= yS || x >= cols || y >= rows) continue;
              if (Math.hypot((x - sx) * aspect, y - sy) <= r) occ[idx(x, y)] = ROCK;
            }
          }
        }
        // trees and their roots
        const nTrees = cols > 120 ? 3 : 2;
        trees = [];
        for (let k = 0; k < nTrees; k++) {
          const x = Math.round(cols * ((k + 0.5) / nTrees + rng.range(-0.08, 0.08)));
          trees.push(x);
          for (let r = 0; r < 4; r++) growRoot(x + rng.range(-1, 1), yS, Math.PI / 2 + rng.range(-1.1, 1.1), Math.round(rows * rng.range(0.12, 0.25)), 0);
        }
        // the first threads start from root tips
        for (let k = 0; k < 10; k++) {
          const i = rng.pick(roots);
          addTip(i % cols, (i / cols) | 0, rng() * Math.PI * 2);
        }
        spores.init(rng, cols, rows, 80, 0, yS);
        spores.glow.fill(0);
        t = 0;
        nextPulse = 3;
        burst = -1;
      },
      update(dt, audio, ctx) {
        t += dt;
        const grow = ctx.params.growth;
        const branching = ctx.params.branching;
        // Tips advance, wander, branch, fuse, and occasionally stop.
        for (let k = 0; k < MAX_TIPS; k++) {
          if (!tAlive[k]) continue;
          tp[k] += dt * grow * 2.2;
          while (tp[k] >= 1 && tAlive[k]) {
            tp[k] -= 1;
            ta[k] += rng.gauss() * 0.28;
            const x = tx[k], y = ty[k];
            const nx = x + (Math.cos(ta[k]) / aspect) * 0.95, ny = y + Math.sin(ta[k]) * 0.95;
            const ix = Math.round(nx), iy = Math.round(ny);
            if (ix < 0 || ix >= cols) { ta[k] = Math.PI - ta[k]; continue; }
            if (iy <= yS || iy >= rows) { ta[k] = -ta[k]; continue; }
            const i = idx(ix, iy);
            if (i === idx(Math.round(x), Math.round(y))) { tx[k] = nx; ty[k] = ny; continue; }
            const o = occ[i];
            if (o === ROCK) { ta[k] += (rng() < 0.5 ? -1 : 1) * rng.range(0.8, 1.6); continue; }
            if (o === ROOT || (o === HYPHA && state[i] === ALIVE)) {
              // fusion: this thread joins the network here
              if (rng() < 0.8) { killTip(k); break; }
              tx[k] = nx; ty[k] = ny;
              continue;
            }
            occupy(i, lineGlyph(nx - x, ny - y, aspect));
            tx[k] = nx; ty[k] = ny;
            if (rng() < 0.05 * branching + 0.01) addTip(nx, ny, ta[k] + (rng() < 0.5 ? -1 : 1) * rng.range(0.5, 1.1));
            if (rng() < 0.004) killTip(k);
            // a thread near the surface may fruit
            if (iy <= yS + 2 && rng() < 0.12 && mushrooms.length < Math.max(2, Math.floor(cols / 25))
              && !mushrooms.some((m) => Math.abs(m.x - ix) < 7) && trees.every((tr) => Math.abs(tr - ix) > 3)) {
              mushrooms.push({ x: ix, born: t, life: rng.range(200, 420), h: rng.int(1, 4), w: rng() < 0.5 ? 3 : 5, phase: rng() * 6 });
            }
          }
        }
        // keep the web growing: new threads sprout from living threads or roots
        while (tipCount < 8) {
          const from = alive > 50 && rng() < 0.7 ? order[(qHead + rng.int(0, Math.max(1, (qTail - qHead + n) % n))) % n] : rng.pick(roots);
          addTip(from % cols, (from / cols) | 0, rng() * Math.PI * 2);
        }
        // the oldest threads die back once the web is full
        while (alive > cap) {
          const i = order[qHead];
          qHead = (qHead + 1) % n;
          if (occ[i] === HYPHA && state[i] === ALIVE) { state[i] = DYING; dieAt[i] = t; alive--; }
        }
        // signals
        const rate = ctx.params.pulses;
        nextPulse -= dt * (0.2 + rate);
        if (rate > 0 && nextPulse <= 0 && roots.length) {
          startPulse(rng.pick(roots));
          nextPulse = rng.range(4, 9);
        }
        sinceBeat += dt;
        if (audio.beat > 0.8 && sinceBeat > 2.5 && roots.length) {
          sinceBeat = 0;
          startPulse(rng.pick(roots));
        }
        pulses = pulses.filter((p) => (t - p.t0) * PULSE_SPEED < p.maxD + 20);
        // mushrooms age; spores drift up from them
        mushrooms = mushrooms.filter((m) => t - m.born < m.life);
        for (const m of mushrooms) {
          if (rng() < dt * (burst >= 0 ? 4 : 0.08) && t - m.born > 20) spores.emit(m.x + rng.range(-1, 1), yS - m.h - 2, 1);
        }
        spores.update(dt, ctx.noise, t, { drift: 0.8, rise: -0.6, calm: 7 });
        if (burst >= 0) {
          burst += dt;
          if (burst > 12) burst = -1;
        }
      },
      event() {
        // Fruiting burst: every mushroom glows bright and releases a cloud of spores.
        burst = 0;
        for (const m of mushrooms) {
          const i = idx(m.x, yS + 1);
          if (occ[i] !== EMPTY) startPulse(i);
        }
      },
      render(grid, ctx) {
        const V = grid.v, C = grid.col, G = grid.glyph;
        const glow = ctx.params.glow;
        const burstGlow = burst >= 0 ? smoothstep(0, 2, burst) * smoothstep(12, 6, burst) : 0;
        // night air and tree trunks above ground
        for (let y = 0; y < yS; y++) {
          for (let x = 0; x < cols; x++) {
            const i = idx(x, y);
            V[i] = 0.006 + 0.012 * (y / yS);
            C[i * 3] = 0.3; C[i * 3 + 1] = 0.4; C[i * 3 + 2] = 0.7;
          }
        }
        for (const tr of trees) {
          const half = Math.max(1, Math.round(rows * 0.02 / aspect));
          for (let y = 0; y < yS; y++) {
            const flare = y > yS - 3 ? yS - 3 - y : 0; // the trunk flares at its base
            for (let x = tr - half + flare; x <= tr + half - flare; x++) {
              if (x < 0 || x >= cols) continue;
              const i = idx(x, y);
              const edge = x === tr - half + flare || x === tr + half - flare;
              V[i] = edge ? 0.07 : 0.02 + (hash2(x, y, 8) > 0.8 ? 0.03 : 0);
              G[i] = edge ? cp('|') : hash2(x, y, 8) > 0.8 ? cp(':') : 0;
              C[i * 3] = 0.55; C[i * 3 + 1] = 0.42; C[i * 3 + 2] = 0.3;
            }
          }
        }
        spores.render(grid, t, 0, [0.45, 1, 0.5], [0.8, 1, 0.75]);
        // soil, stones, roots and hyphae
        for (let y = yS; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const i = idx(x, y);
            const c = i * 3;
            const o = occ[i];
            let v = 0, r = 0.5, g = 0.38, b = 0.28, gl = 0;
            if (y === yS) {
              // leaf litter along the surface
              const h = hash2(x, 1, 4);
              v = 0.08 + 0.05 * h; gl = cp(h > 0.7 ? ',' : h > 0.4 ? '_' : '.');
              r = 0.6; g = 0.45; b = 0.3;
            } else if (o === ROCK) {
              v = 0.05; gl = hash2(x, y, 2) > 0.6 ? cp('o') : 0; r = 0.55; g = 0.55; b = 0.55;
            } else if (o === ROOT) {
              v = 0.13; gl = glyph[i]; r = 0.65; g = 0.45; b = 0.28;
            } else if (o === HYPHA) {
              const age = t - born[i];
              let f = 1;
              if (state[i] === DYING) {
                f = 1 - (t - dieAt[i]) / 25;
                if (f <= 0) { occ[i] = EMPTY; state[i] = 0; f = 0; }
              }
              v = (0.09 + 0.12 * Math.exp(-age / 40)) * f;
              gl = f > 0 ? glyph[i] : 0;
              r = 0.88; g = 0.85; b = 0.72;
            } else {
              const h = hash2(x, y, 6);
              v = 0.012 + (h > 0.92 ? 0.03 : 0);
              r = 0.45; g = 0.35; b = 0.28;
            }
            // pulses of light travelling along the network
            if (o === ROOT || o === HYPHA) {
              let p = 0;
              for (const pl of pulses) {
                const d = pl.dist[i];
                if (d < 0) continue;
                const front = (t - pl.t0) * PULSE_SPEED;
                const ahead = d - front;
                const fade = clamp(1 - front / (pl.maxD + 20));
                p = Math.max(p, (Math.exp(-ahead * ahead / 18) + (ahead < 0 ? 0.4 * Math.exp(ahead / 25) : 0)) * (0.45 + 0.55 * fade));
              }
              if (p > 0.02) {
                const w = clamp(p);
                v = Math.max(v, w * 0.85 * glow);
                r += (0.35 - r) * w; g += (1 - g) * w; b += (0.75 - b) * w;
              }
            }
            V[i] = clamp(v);
            G[i] = gl;
            C[c] = r; C[c + 1] = g; C[c + 2] = b;
          }
        }
        // growing tips glow white
        for (let k = 0; k < MAX_TIPS; k++) if (tAlive[k]) grid.max(tx[k], ty[k], clamp(0.5 * glow), 1, 1, 0.9, cp('*'));
        // glowing mushrooms (foxfire green), growing in and wilting away
        for (const m of mushrooms) {
          const age = t - m.born;
          const g = smoothstep(0, 25, age) * (1 - smoothstep(m.life - 30, m.life, age));
          const h = Math.max(1, Math.round(m.h * smoothstep(0, 20, age)));
          const w = age < 12 ? 1 : m.w;
          const pulse = 0.5 + 0.5 * Math.sin(t * 0.9 + m.phase);
          const capV = clamp((0.3 + 0.35 * pulse + burstGlow * 0.4) * g * glow);
          for (let k = 1; k <= h; k++) grid.set(m.x, yS - k, 0.18 * g, 0.85, 0.9, 0.75, cp('|'));
          const top = yS - h - 1;
          if (w === 1) {
            grid.set(m.x, top, capV, 0.5, 1, 0.45, cp('o'));
          } else {
            const half = (w - 1) / 2;
            grid.text(m.x - half, top, '(' + '_'.repeat(w - 2) + ')', capV, 0.5, 1, 0.45);
            grid.text(m.x - half, top - 1, '.' + '-'.repeat(w - 2) + '.', capV * 0.9, 0.5, 1, 0.45);
            // the glow spills onto the litter around it
            for (let dx = -half - 2; dx <= half + 2; dx++) grid.max(m.x + dx, yS, capV * 0.35, 0.5, 1, 0.45);
          }
        }
      },
    };
  },
};

export default mycelium;
