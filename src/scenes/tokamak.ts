import { clamp, fcos, fsin, TAU } from '../engine/math';
import type { SceneDef } from '../engine/types';

const cp = (c: string) => c.codePointAt(0)!;

class Cam {
  cr = 1; sr = 0; ct = 1; st = 0; S = 1; cx = 0; cy = 0; asp = 0.6;
  x = 0; y = 0; f = 1;
  set(rot: number, tilt: number, S: number, cx: number, cy: number, asp: number) {
    this.cr = Math.cos(rot); this.sr = Math.sin(rot);
    this.ct = Math.cos(tilt); this.st = Math.sin(tilt);
    this.S = S; this.cx = cx; this.cy = cy; this.asp = asp;
  }
  /** Rotate about the vertical axis, tilt toward the viewer, then perspective-project. */
  project(x: number, y: number, z: number) {
    const x1 = x * this.cr - z * this.sr;
    const z1 = x * this.sr + z * this.cr;
    const y2 = y * this.ct - z1 * this.st;
    const z2 = y * this.st + z1 * this.ct;
    const f = 3.4 / (3.4 + z2);
    this.x = this.cx + (x1 * f * this.S) / this.asp;
    this.y = this.cy - y2 * f * this.S;
    this.f = f;
    return z2;
  }
}

/** Additive light accumulation with bilinear splats. */
class Accum {
  cols = 0; rows = 0;
  acc = new Float32Array(0); ar = new Float32Array(0); ag = new Float32Array(0); ab = new Float32Array(0);
  resize(cols: number, rows: number) {
    this.cols = cols; this.rows = rows;
    const n = cols * rows;
    this.acc = new Float32Array(n); this.ar = new Float32Array(n); this.ag = new Float32Array(n); this.ab = new Float32Array(n);
  }
  clear() {
    this.acc.fill(0); this.ar.fill(0); this.ag.fill(0); this.ab.fill(0);
  }
  private add(xx: number, yy: number, w: number, r: number, g: number, b: number) {
    if (xx < 0 || yy < 0 || xx >= this.cols || yy >= this.rows) return;
    const i = yy * this.cols + xx;
    this.acc[i] += w; this.ar[i] += r * w; this.ag[i] += g * w; this.ab[i] += b * w;
  }
  splat(x: number, y: number, w: number, r: number, g: number, b: number) {
    const x0 = Math.floor(x - 0.5), y0 = Math.floor(y - 0.5);
    const fx = x - 0.5 - x0, fy = y - 0.5 - y0;
    this.add(x0, y0, w * (1 - fx) * (1 - fy), r, g, b);
    this.add(x0 + 1, y0, w * fx * (1 - fy), r, g, b);
    this.add(x0, y0 + 1, w * (1 - fx) * fy, r, g, b);
    this.add(x0 + 1, y0 + 1, w * fx * fy, r, g, b);
  }
}

/**
 * A rotating plasma torus inside its magnetic cage: glowing plasma flowing toroidally,
 * helical field lines, kink instabilities, and the occasional disruption and re-formation.
 */
const tokamak: SceneDef = {
  id: 'tokamak',
  name: 'Tokamak',
  family: 'scenic',
  blurb: 'A rotating plasma torus with field lines and instabilities',
  recommended: { style: 'vapor', colorMode: 'native' },
  defaultSeed: 3141,
  params: [
    { key: 'speed', label: 'Rotation', min: 0, max: 2, default: 0.5 },
    { key: 'turbulence', label: 'Turbulence', min: 0, max: 1, default: 0.35 },
    { key: 'fieldLines', label: 'Field lines', min: 0, max: 1, default: 0.6 },
    { key: 'tilt', label: 'Tilt', min: 0.1, max: 1, default: 0.62 },
  ],
  create() {
    let cols = 0, rows = 0, n = 0;
    let rot = 0, flow = 0, t = 0, turb = 0;
    let disrupt = -1;
    const SP = 400;
    const spx = new Float32Array(SP), spy = new Float32Array(SP), spz = new Float32Array(SP);
    const svx = new Float32Array(SP), svy = new Float32Array(SP), svz = new Float32Array(SP), slife = new Float32Array(SP);
    let phases = new Float32Array(16);

    const cam = new Cam();
    const A = new Accum();

    return {
      init(ctx) {
        cols = ctx.cols; rows = ctx.rows; n = cols * rows;
        A.resize(cols, rows);
        rot = ctx.rng() * TAU;
        phases = Float32Array.from({ length: 16 }, () => ctx.rng() * TAU);
        slife.fill(0);
        disrupt = -1;
      },
      update(dt, audio, ctx) {
        t += dt;
        rot += dt * 0.06 * ctx.params.speed;
        flow += dt * 0.9;
        const target = ctx.params.turbulence + (audio.bands[1] + audio.bands[2]) * 0.5;
        turb += (target - turb) * Math.min(1, dt * 1.5);
        if (disrupt >= 0) {
          disrupt += dt;
          if (disrupt > 16) disrupt = -1;
        }
        for (let i = 0; i < SP; i++) {
          if (slife[i] <= 0) continue;
          slife[i] -= dt * 0.5;
          spx[i] += svx[i] * dt; spy[i] += svy[i] * dt; spz[i] += svz[i] * dt;
        }
      },
      event(ctx) {
        disrupt = 0;
        // ejecta leave from random points on the surface at the quench
        for (let i = 0; i < SP; i++) {
          const u = ctx.rng() * TAU, v = ctx.rng() * TAU;
          const R = 1 + 0.34 * fcos(v);
          spx[i] = R * fcos(u); spy[i] = 0.34 * fsin(v); spz[i] = R * fsin(u);
          const sp = ctx.rng.range(0.2, 0.9);
          svx[i] = (fcos(v) * fcos(u) + ctx.rng.gauss() * 0.3) * sp;
          svy[i] = (fsin(v) + ctx.rng.gauss() * 0.3) * sp;
          svz[i] = (fcos(v) * fsin(u) + ctx.rng.gauss() * 0.3) * sp;
          slife[i] = -ctx.rng.range(1.6, 2.2); // negative = waiting to launch
        }
      },
      render(grid, ctx) {
        A.clear();
        cam.set(rot, ctx.params.tilt, Math.min(cols * ctx.aspect, rows) * 0.36, cols / 2, rows / 2, ctx.aspect);

        // Disruption envelope: instability grows, thermal quench, current quench, re-formation.
        let grow = 0, bright = 1, expand = 0, flash = 0;
        if (disrupt >= 0) {
          const d = disrupt;
          grow = clamp(d / 1.8);
          if (d > 1.8) {
            flash = d < 2.3 ? (d - 1.8) / 0.5 : Math.exp(-(d - 2.3) * 2.2);
            if (ctx.reducedMotion) flash *= 0.2;
            expand = clamp((d - 1.8) / 1.5);
            bright = d < 3.5 ? 1 : d < 6 ? Math.max(0.03, 1 - (d - 3.5) / 2) : clamp((d - 6) / 9) + 0.03;
            grow = d < 6 ? 1 - clamp((d - 3.5) / 2.5) : 0;
            if (d > 6) expand = 1 - clamp((d - 6) / 6);
          }
          for (let i = 0; i < SP; i++) if (slife[i] < 0 && d > 1.8) slife[i] = -slife[i];
        }
        const kink = 0.05 + turb * 0.09 + grow * 0.2;
        const r0 = 0.26 * (1 + expand * 0.7);

        // Plasma volume as surface samples, additively splatted: limbs glow brighter naturally.
        const Nu = Math.round(clamp(cols * 1.3, 180, 420));
        const Nv = Math.round(clamp(rows * 0.8, 28, 60));
        const shells = 1;
        for (let s = 0; s < shells; s++) {
          const rs = r0;
          const wShell = 0.8 * bright;
          for (let iu = 0; iu < Nu; iu++) {
            const u = (iu / Nu) * TAU;
            const cu = fcos(u), su = fsin(u);
            // kink: the magnetic axis wobbles, rotating with time
            const axR = 1 + kink * 0.35 * fsin(2 * u - t * 0.7 + phases[0]);
            const axY = kink * 0.3 * fcos(3 * u + t * 0.5 + phases[1]);
            for (let iv = 0; iv < Nv; iv++) {
              const v = (iv / Nv) * TAU + iu * 0.37;
              const mode = fsin(3 * v - 2 * u + t * 1.1 + phases[2]) * 0.5 + fsin(5 * v + 4 * u - t * 1.7 + phases[3]) * 0.3;
              const r = rs * (1 + kink * mode);
              const R = axR + r * fcos(v);
              const x = R * cu, z = R * su, y = axY + r * fsin(v);
              cam.project(x, y, z);
              const dens = 0.55 + 0.25 * fsin(3 * u - 2 * v - flow + phases[4]) + 0.2 * fsin(7 * u + 3 * v + flow * 1.3);
              const hot = clamp(dens * (s === 0 ? 1.2 : 1));
              const w = wShell * dens * cam.f;
              // magenta-violet plasma with hot pale cores
              A.splat(cam.x, cam.y, w, 0.85 + 0.15 * hot, 0.25 + 0.5 * hot * hot, 0.95);
            }
          }
        }

        // Helical field lines on a surface just outside the plasma
        const fl = ctx.params.fieldLines;
        if (fl > 0) {
          const lines = Math.round(4 + fl * 6);
          const q = 2.5 + turb;
          const steps = Math.round(clamp(cols * 3.5, 500, 1200));
          for (let k = 0; k < lines; k++) {
            const ph = (k / lines) * TAU + t * 0.25;
            for (let i = 0; i < steps; i++) {
              const u = (i / steps) * TAU;
              const v = q * u + ph;
              const r = r0 * 1.12 * (1 + kink * 0.4 * fsin(3 * v - 2 * u + t * 1.1 + phases[2]));
              const R = 1 + r * fcos(v);
              const z2 = cam.project(R * fcos(u), r * fsin(v), R * fsin(u));
              const front = z2 < 0 ? 1 : 0.45;
              A.splat(cam.x, cam.y, 0.22 * fl * front * cam.f * (0.4 + 0.6 * bright), 0.5, 0.85, 1);
            }
          }
        }

        // Toroidal field coils and central solenoid, dim and steely
        const coils = 12;
        for (let k = 0; k < coils; k++) {
          const u = (k / coils) * TAU;
          for (let i = 0; i < 90; i++) {
            const v = (i / 90) * TAU;
            const rr = 0.58;
            const R = 1 + rr * fcos(v) * 0.92;
            const z2 = cam.project(R * fcos(u), rr * 1.15 * fsin(v), R * fsin(u));
            A.splat(cam.x, cam.y, (z2 < 0 ? 0.06 : 0.025) * cam.f, 0.55, 0.65, 0.85);
          }
        }
        for (let i = 0; i < 40; i++) {
          const y = -0.75 + (i / 40) * 1.5;
          cam.project(0, y, 0);
          A.splat(cam.x, cam.y, 0.1, 0.6, 0.7, 0.9);
        }

        // Ejecta from a disruption
        for (let i = 0; i < SP; i++) {
          if (slife[i] <= 0) continue;
          cam.project(spx[i], spy[i], spz[i]);
          A.splat(cam.x, cam.y, slife[i] * 1.2, 1, 0.8, 0.95);
        }

        // Tone map accumulated light into brightness
        const V = grid.v, C = grid.col, G = grid.glyph;
        const gain = (cols * rows) / (Nu * Nv * shells) * 1.1;
        for (let i = 0; i < n; i++) {
          const a = A.acc[i];
          if (a <= 0) continue;
          let v = 1 - Math.exp(-a * gain);
          v = clamp(v + flash * v * 0.8);
          V[i] = v;
          const c = i * 3;
          C[c] = Math.min(1, A.ar[i] / a + flash * 0.3);
          C[c + 1] = Math.min(1, A.ag[i] / a + flash * 0.3);
          C[c + 2] = Math.min(1, A.ab[i] / a + flash * 0.2);
        }
        // a quiet readout in the corner, like a control-room monitor
        if (!ctx.thumbnail && rows > 20 && cols > 60) {
          const shot = Math.floor(t / 8 + 40213);
          const status = disrupt >= 0 && disrupt < 6 ? 'DISRUPTION' : disrupt >= 6 ? 'RAMP-UP' : 'FLAT-TOP';
          const label = `SHOT ${shot}  Ip ${(bright * (12.4 + fsin(t * 0.3) * 0.2)).toFixed(1)} MA  ${status}`;
          grid.text(2, rows - 3, label, 0.32, 0.6, 0.8, 1);
          for (let i = 0; i < label.length; i++) G[(rows - 3) * cols + 2 + i] = G[(rows - 3) * cols + 2 + i] || cp(' ');
        }
      },
    };
  },
};

export default tokamak;
