import { clamp } from '../engine/math';
import type { Rng } from '../engine/rng';
import type { SceneDef } from '../engine/types';

const cp = (c: string) => c.codePointAt(0)!;
const WIN = cp('▪');

const WINDOW_COLORS: [number, number, number][] = [
  [1, 0.78, 0.42], // warm incandescent
  [1, 0.86, 0.6],
  [0.75, 0.88, 1], // cool LED
  [0.55, 0.7, 1], // TV glow
];

type Weather = 'clear' | 'drizzle' | 'rain' | 'snow' | 'fog';

/** Skyline with living windows, passing traffic, streetlights, slow weather, and a rare walker. */
const nightcity: SceneDef = {
  id: 'nightcity',
  name: 'Night City',
  family: 'scenic',
  blurb: 'Skyline, flickering windows, traffic and weather',
  recommended: { style: 'amber-crt' },
  defaultSeed: 1982,
  params: [
    { key: 'lights', label: 'Lit windows', min: 0.05, max: 1, default: 0.45 },
    { key: 'traffic', label: 'Traffic', min: 0, max: 1, default: 0.5 },
    { key: 'weather', label: 'Weather', min: 0, max: 1, default: 0.5 },
  ],
  create() {
    let cols = 0, rows = 0, n = 0;
    let sV = new Float32Array(0), sC = new Float32Array(0), sG = new Uint32Array(0);
    // windows
    let wx = new Int32Array(0), wy = new Int32Array(0), wOn = new Float32Array(0), wTarget = new Uint8Array(0);
    let wCol = new Uint8Array(0), wFar = new Uint8Array(0), wPh = new Float32Array(0);
    let nWin = 0;
    // antennas
    const ant: { x: number; y: number; ph: number }[] = [];
    // street
    let sidewalk = 0, lanes: number[] = [];
    const lamps: number[] = [];
    const CMAX = 40;
    const cx = new Float32Array(CMAX), cl = new Uint8Array(CMAX), cs = new Float32Array(CMAX), cAlive = new Uint8Array(CMAX);
    // weather
    let weather: Weather = 'clear', weatherT = 0, weatherAmt = 0, nextWeather: Weather = 'clear';
    const PMAX = 700;
    const px = new Float32Array(PMAX), py = new Float32Array(PMAX), pv = new Float32Array(PMAX);
    // walker and plane
    let walker = -1, walkerX = 0, walkerDir = 1;
    let plane = -1, planeX = 0, planeY = 0, planeDir = 1;
    let t = 0;
    let moonX = 0, moonY = 0;
    let rng: Rng;

    const building = (x0: number, w: number, h: number, far: boolean, ground: number) => {
      const top = Math.max(1, ground - h);
      for (let y = top; y < ground; y++) {
        for (let x = x0; x < x0 + w && x < cols; x++) {
          if (x < 0) continue;
          const i = y * cols + x;
          const edge = x === x0 || x === x0 + w - 1;
          sV[i] = far ? 0.02 : 0.035;
          sG[i] = 32;
          if (!far && edge) { sV[i] = 0.07; sG[i] = cp('|'); }
          if (y === top) { sV[i] = far ? 0.05 : 0.09; sG[i] = cp(far ? '.' : '_'); }
          const c = i * 3;
          sC[c] = 0.45; sC[c + 1] = 0.5; sC[c + 2] = 0.7;
        }
      }
      // windows
      const stepX = far ? 2 : rng() < 0.5 ? 2 : 3;
      const stepY = far ? 2 : rng() < 0.3 ? 1 : 2;
      for (let y = top + 2; y < ground - 1; y += stepY) {
        for (let x = x0 + 1 + ((w - 2) % stepX >> 1); x < x0 + w - 1; x += stepX) {
          if (x < 0 || x >= cols || nWin >= wx.length) continue;
          wx[nWin] = x; wy[nWin] = y; wFar[nWin] = far ? 1 : 0;
          wCol[nWin] = rng() < 0.6 ? 0 : rng() < 0.5 ? 1 : rng() < 0.75 ? 2 : 3;
          wPh[nWin] = rng() * 100;
          wTarget[nWin] = rng() < 0.45 ? 1 : 0;
          wOn[nWin] = wTarget[nWin];
          nWin++;
        }
      }
      // rooftop antenna with a slow red beacon
      if (!far && h > rows * 0.35 && rng() < 0.6) {
        const ax = x0 + (w >> 1);
        const ah = 2 + rng.int(0, 3);
        for (let k = 1; k <= ah; k++) {
          const y = top - k;
          if (y < 0) break;
          const i = y * cols + ax;
          sV[i] = 0.08; sG[i] = cp('|');
          sC[i * 3] = 0.6; sC[i * 3 + 1] = 0.6; sC[i * 3 + 2] = 0.7;
        }
        ant.push({ x: ax, y: top - ah - 1, ph: rng() * 6.28 });
      }
    };

    const spawnCar = (lane: number) => {
      for (let i = 0; i < CMAX; i++) {
        if (cAlive[i]) continue;
        cAlive[i] = 1;
        cl[i] = lane;
        const dir = lane % 2 === 0 ? 1 : -1;
        cs[i] = dir * rng.range(7, 13);
        cx[i] = dir > 0 ? -6 : cols + 6;
        return;
      }
    };

    return {
      init(ctx) {
        cols = ctx.cols; rows = ctx.rows; n = cols * rows;
        rng = ctx.rng;
        sV = new Float32Array(n); sC = new Float32Array(n * 3); sG = new Uint32Array(n);
        const maxWin = Math.ceil(n / 2);
        wx = new Int32Array(maxWin); wy = new Int32Array(maxWin); wOn = new Float32Array(maxWin);
        wTarget = new Uint8Array(maxWin); wCol = new Uint8Array(maxWin); wFar = new Uint8Array(maxWin); wPh = new Float32Array(maxWin);
        nWin = 0;
        ant.length = 0;
        const streetH = Math.max(4, Math.round(rows * 0.13));
        const ground = rows - streetH;
        sidewalk = ground;
        lanes = [];
        for (let k = 0; k < Math.min(4, streetH - 2); k++) lanes.push(ground + 2 + k);
        // sky gradient, stars
        for (let y = 0; y < ground; y++) {
          for (let x = 0; x < cols; x++) {
            const i = y * cols + x;
            sV[i] = 0.015 + 0.035 * (y / ground) ** 2;
            sC[i * 3] = 0.4; sC[i * 3 + 1] = 0.45; sC[i * 3 + 2] = 0.8;
            if (rng() < 0.012 && y < ground * 0.5) { sV[i] = 0.12 + rng() * 0.12; sG[i] = cp('.'); sC[i * 3] = 0.9; sC[i * 3 + 1] = 0.9; sC[i * 3 + 2] = 1; }
          }
        }
        moonX = rng.range(0.6, 0.9) * cols; moonY = rows * rng.range(0.1, 0.2);
        // far layer, then near layer
        for (let x = -2; x < cols;) {
          const w = rng.int(5, 12);
          building(x, w, Math.floor(rows * rng.range(0.25, 0.48)), true, ground);
          x += w + rng.int(-1, 2);
        }
        for (let x = -3; x < cols;) {
          const w = rng.int(7, 17);
          const h = Math.floor(rows * (rng() < 0.2 ? rng.range(0.45, 0.68) : rng.range(0.16, 0.42)));
          building(x, w, h, false, ground);
          x += w + rng.int(1, 5);
        }
        // street: sidewalk line, lamps, road
        for (let x = 0; x < cols; x++) {
          const i = sidewalk * cols + x;
          sV[i] = 0.1; sG[i] = cp('_'); sC[i * 3] = 0.6; sC[i * 3 + 1] = 0.6; sC[i * 3 + 2] = 0.65;
          for (let y = sidewalk + 1; y < rows; y++) {
            const j = y * cols + x;
            sV[j] = 0.02; sG[j] = 32; sC[j * 3] = 0.5; sC[j * 3 + 1] = 0.5; sC[j * 3 + 2] = 0.6;
          }
          if (lanes.length >= 2 && x % 6 < 3) {
            const mid = Math.floor((lanes[0] + lanes[lanes.length - 1]) / 2 + 0.5);
            const j = mid * cols + x;
            if (lanes.length > 2) { sV[j] = 0.06; sG[j] = cp('-'); sC[j * 3] = 0.9; sC[j * 3 + 1] = 0.8; sC[j * 3 + 2] = 0.4; }
          }
        }
        lamps.length = 0;
        for (let x = rng.int(4, 12); x < cols; x += rng.int(18, 28)) lamps.push(x);
        cAlive.fill(0);
        for (let i = 0; i < PMAX; i++) { px[i] = rng() * cols; py[i] = rng() * rows; pv[i] = rng(); }
        weather = 'clear'; weatherAmt = 0; weatherT = rng.range(60, 200);
        walker = -1; plane = -1;
        t = 0;
      },
      update(dt, audio, ctx) {
        t += dt;
        const lit = ctx.params.lights;
        // windows: people come and go
        for (let k = 0; k < nWin; k++) {
          if (rng() < dt * 0.006) wTarget[k] = rng() < lit ? 1 : 0;
          wOn[k] += ((wTarget[k] ? 1 : 0) - wOn[k]) * Math.min(1, dt * 1.5);
        }
        // traffic
        const rate = ctx.params.traffic * 0.35;
        for (let l = 0; l < lanes.length; l++) if (rng() < dt * rate) spawnCar(l);
        for (let i = 0; i < CMAX; i++) {
          if (!cAlive[i]) continue;
          cx[i] += cs[i] * dt;
          if (cx[i] < -12 || cx[i] > cols + 12) cAlive[i] = 0;
        }
        // weather drifts between states
        weatherT -= dt;
        if (weatherT <= 0) {
          const opts: Weather[] = ['clear', 'clear', 'drizzle', 'rain', 'snow', 'fog'];
          nextWeather = ctx.params.weather < 0.05 ? 'clear' : rng.pick(opts);
          weatherT = rng.range(150, 420);
        }
        if (weather !== nextWeather) {
          weatherAmt -= dt * 0.05;
          if (weatherAmt <= 0) { weatherAmt = 0; weather = nextWeather; }
        } else {
          weatherAmt = Math.min(1, weatherAmt + dt * 0.04);
        }
        const wind = Math.sin(t * 0.05) * 0.3;
        for (let i = 0; i < PMAX; i++) {
          if (weather === 'snow') {
            py[i] += (1.2 + pv[i] * 1.5) * dt;
            px[i] += (Math.sin(t * 0.7 + pv[i] * 20) * 0.8 + wind * 2) * dt;
          } else {
            py[i] += (22 + pv[i] * 10) * dt;
            px[i] += (wind * 10 + 3) * dt;
          }
          if (py[i] > rows) { py[i] -= rows + 2; px[i] = rng() * cols; }
          if (px[i] > cols) px[i] -= cols;
          if (px[i] < 0) px[i] += cols;
        }
        if (walker >= 0) {
          walker += dt;
          walkerX += walkerDir * dt * 1.4;
          if (walkerX < -5 || walkerX > cols + 5) walker = -1;
        }
        if (plane < 0 && rng() < dt / 240) {
          plane = 0; planeDir = rng() < 0.5 ? 1 : -1; planeX = planeDir > 0 ? -2 : cols + 2; planeY = rows * rng.range(0.06, 0.25);
        }
        if (plane >= 0) {
          plane += dt;
          planeX += planeDir * dt * 3.5;
          if (planeX < -4 || planeX > cols + 4) plane = -1;
        }
      },
      event(ctx) {
        walker = 0;
        walkerDir = ctx.rng() < 0.5 ? 1 : -1;
        walkerX = walkerDir > 0 ? -3 : cols + 3;
      },
      render(grid, ctx) {
        const V = grid.v, C = grid.col, G = grid.glyph;
        V.set(sV); C.set(sC); G.set(sG);
        // moon
        const mr = Math.max(1.5, rows * 0.045);
        for (let y = Math.floor(moonY - mr); y <= moonY + mr; y++) {
          for (let x = Math.floor(moonX - mr / ctx.aspect); x <= moonX + mr / ctx.aspect; x++) {
            const dx = (x - moonX) * ctx.aspect, dy = y - moonY;
            const d = Math.sqrt(dx * dx + dy * dy) / mr;
            if (d > 1.6) continue;
            // crescent: subtract an offset disc
            const dx2 = (x - moonX) * ctx.aspect + mr * 0.45, d2 = Math.sqrt(dx2 * dx2 + dy * dy) / mr;
            const body = d < 1 && d2 > 0.95 ? 0.8 : 0;
            const halo = clamp(1.6 - d) * 0.08;
            grid.max(x, y, Math.max(body, halo), 1, 0.95, 0.8);
          }
        }
        // windows
        const treble = ctx.audio.bands[3];
        for (let k = 0; k < nWin; k++) {
          const on = wOn[k];
          if (on < 0.03) continue;
          const i = wy[k] * cols + wx[k];
          const col = WINDOW_COLORS[wCol[k]];
          let b = (wFar[k] ? 0.3 : 0.62) * on;
          if (wCol[k] === 3) b *= 0.75 + 0.25 * Math.sin(t * 2.1 + wPh[k]) * Math.sin(t * 0.9 + wPh[k] * 2); // TV flicker, slow
          if (treble > 0.05 && k % 7 === 0) b *= 1 - treble * 0.5;
          V[i] = b;
          G[i] = wFar[k] ? cp('.') : WIN;
          C[i * 3] = col[0]; C[i * 3 + 1] = col[1]; C[i * 3 + 2] = col[2];
        }
        // antenna beacons: slow 0.5 Hz breathing, well under any flash threshold
        for (const a of ant) {
          const b = 0.25 + 0.55 * Math.max(0, Math.sin(t * Math.PI * 0.5 + a.ph));
          grid.set(a.x, a.y, b, 1, 0.2, 0.15, cp('•'));
        }
        // streetlights
        for (const lx of lamps) {
          const top = sidewalk - 4;
          for (let y = top + 1; y < sidewalk; y++) grid.set(lx, y, 0.12, 0.6, 0.6, 0.65, cp('|'));
          grid.set(lx, top, 0.85, 1, 0.8, 0.45, cp('o'));
          for (let y = top + 1; y < rows; y++) {
            const spread = (y - top) * 0.9;
            for (let x = Math.floor(lx - spread); x <= lx + spread; x++) {
              const f = 1 - Math.abs(x - lx) / (spread + 1);
              grid.max(x, y, 0.04 + 0.1 * f * (y >= sidewalk ? 1 : 0.6), 1, 0.75, 0.4);
            }
          }
        }
        // traffic
        for (let i = 0; i < CMAX; i++) {
          if (!cAlive[i]) continue;
          const y = lanes[cl[i]];
          const dir = cs[i] > 0 ? 1 : -1;
          const front = cx[i];
          // headlight beam
          for (let k = 1; k <= 5; k++) grid.max(front + dir * k, y, 0.32 * (1 - k / 6), 1, 0.95, 0.8);
          grid.set(front, y, 0.95, 1, 0.97, 0.85, cp('='));
          grid.set(front - dir * 4, y, 0.6, 1, 0.2, 0.15, cp('-'));
          grid.max(front - dir, y, 0.06, 0.4, 0.4, 0.5);
          grid.max(front - dir * 2, y, 0.06, 0.4, 0.4, 0.5);
          grid.max(front - dir * 3, y, 0.06, 0.4, 0.4, 0.5);
        }
        // the lone walker
        if (walker >= 0) {
          const x = Math.round(walkerX);
          const legs = Math.floor(walker * 2.2) % 2 === 0 ? '/ \\' : ' | ';
          let lampLight = 0.45;
          for (const lx of lamps) lampLight = Math.max(lampLight, 0.85 - Math.abs(lx - x) * 0.06);
          grid.text(x - 1, sidewalk - 3, ' o ', lampLight, 0.9, 0.85, 0.8);
          grid.text(x - 1, sidewalk - 2, '/|\\', lampLight, 0.9, 0.85, 0.8);
          grid.text(x - 1, sidewalk - 1, legs, lampLight, 0.9, 0.85, 0.8);
        }
        if (plane >= 0) {
          const blink = Math.sin(plane * Math.PI) > 0.6 ? 0.8 : 0.3;
          grid.set(planeX, planeY, blink, 1, 0.3, 0.3, cp('•'));
          grid.set(planeX - planeDir, planeY, 0.35, 0.9, 0.9, 1, cp('-'));
        }
        // weather
        const wAmt = weatherAmt * ctx.params.weather;
        if (wAmt > 0.01 && weather !== 'clear') {
          if (weather === 'fog') {
            for (let y = Math.floor(rows * 0.45); y < rows; y++) {
              for (let x = 0; x < cols; x++) {
                const f = clamp(ctx.noise.fbm3(x * ctx.aspect * 0.03 + t * 0.02, y * 0.06, t * 0.01, 2) + 0.3) * wAmt * 0.16 * ((y - rows * 0.45) / (rows * 0.55));
                const i = y * cols + x;
                V[i] = V[i] + f * (1 - V[i]);
              }
            }
          } else {
            const count = Math.floor(PMAX * wAmt * (weather === 'drizzle' ? 0.3 : weather === 'snow' ? 0.5 : 0.8));
            for (let i = 0; i < count; i++) {
              if (weather === 'snow') grid.max(px[i], py[i], 0.3 + pv[i] * 0.4, 0.95, 0.97, 1, pv[i] > 0.85 ? cp('*') : cp('.'));
              else {
                grid.max(px[i], py[i], 0.16 + pv[i] * 0.12, 0.6, 0.7, 0.9, cp('/'));
                grid.max(px[i] - 0.3, py[i] - 1, 0.1, 0.6, 0.7, 0.9, cp('/'));
              }
            }
          }
        }
      },
    };
  },
};

export default nightcity;
