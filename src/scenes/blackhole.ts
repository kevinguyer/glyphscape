import { clamp, smoothstep } from '../engine/math';
import { hash2 } from '../engine/rng';
import type { SceneDef } from '../engine/types';
import { fireColor } from './kit';

// Geometry in units of the hole's mass (G = c = M = 1): horizon at r = 2, photon sphere at 3.
const R_IN = 3.2, R_OUT = 14, HORIZON = 2, CAM_D = 30;
const SKY = 0, DISK = 1, SHADOW = 2;
const LAYER_PERIOD = 40;

/** Per-cell result of tracing one light ray backward from the camera. */
interface LensMap {
  kind: Uint8Array;
  /** Disk hit: radius, angle, and a precomputed brightness (temperature x Doppler x redshift). */
  r: Float32Array;
  phi: Float32Array;
  boost: Float32Array;
  /** 1 for the lensed (far-side) images that wrap over and under the shadow. */
  order: Uint8Array;
  /** Sky: escape direction. b: impact parameter, which places the photon ring (b = 3√3). */
  dx: Float32Array;
  dy: Float32Array;
  dz: Float32Array;
  b: Float32Array;
}

/**
 * Trace a ray through a Schwarzschild-like field using the classic Binet trick: in flat
 * coordinates a photon obeys x'' = -1.5 h^2 x / r^5, with h the (conserved) angular momentum.
 * That reproduces the shadow, photon ring, and the lensed far side of the disk.
 */
function traceMap(cols: number, rows: number, aspect: number, tilt: number): LensMap {
  const n = cols * rows;
  const m: LensMap = {
    kind: new Uint8Array(n), r: new Float32Array(n), phi: new Float32Array(n), boost: new Float32Array(n),
    order: new Uint8Array(n), dx: new Float32Array(n), dy: new Float32Array(n), dz: new Float32Array(n), b: new Float32Array(n),
  };
  const se = Math.sin(tilt), ce = Math.cos(tilt);
  // camera above the disk plane, looking at the hole
  const cx0 = 0, cy0 = CAM_D * se, cz0 = -CAM_D * ce;
  const fx = 0, fy = -se, fz = ce; // forward
  const uy = ce, uz = se; // up (right is +x)
  // field of view: the disk fits the width, the lensed arcs fit the height
  const halfW = (cols * aspect) / 2, halfH = rows / 2;
  const S = Math.min(halfW / ((R_OUT * 1.08) / CAM_D), halfH / (9 / CAM_D));
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const su = ((x + 0.5 - cols / 2) * aspect) / S;
      const sv = -(y + 0.5 - rows / 2) / S;
      let vx = fx + su, vy = fy + sv * uy, vz = fz + sv * uz;
      const vl = Math.hypot(vx, vy, vz);
      vx /= vl; vy /= vl; vz /= vl;
      let px = cx0, py = cy0, pz = cz0;
      const hx = py * vz - pz * vy, hy = pz * vx - px * vz, hz = px * vy - py * vx;
      const h2 = hx * hx + hy * hy + hz * hz;
      m.b[i] = Math.sqrt(h2);
      let crossings = 0, kind = SHADOW;
      for (let step = 0; step < 600; step++) {
        const r = Math.hypot(px, py, pz);
        if (r < HORIZON) break;
        if (r > CAM_D * 1.6 && px * vx + py * vy + pz * vz > 0) {
          kind = SKY;
          break;
        }
        const dt = Math.max(0.01, Math.min(1, 0.04 * r));
        const k = (-1.5 * h2) / (r * r * r * r * r);
        vx += k * px * dt; vy += k * py * dt; vz += k * pz * dt;
        const qy = py;
        px += vx * dt; py += vy * dt; pz += vz * dt;
        if (qy * py < 0) {
          // crossed the disk plane: interpolate the crossing point
          const f = qy / (qy - py);
          const hxp = px - vx * dt * (1 - f), hzp = pz - vz * dt * (1 - f);
          const rc = Math.hypot(hxp, hzp);
          if (rc >= R_IN && rc <= R_OUT) {
            kind = DISK;
            m.r[i] = rc;
            const phi = Math.atan2(hzp, hxp);
            m.phi[i] = phi;
            m.order[i] = crossings > 0 ? 1 : 0;
            // Doppler beaming: gas orbits counterclockwise seen from above; light leaves toward
            // the camera, opposite to the traced ray.
            const vl2 = Math.hypot(vx, vy, vz);
            const beta = Math.min(0.6, Math.sqrt(1 / rc));
            const cosT = (-Math.sin(phi) * -vx + Math.cos(phi) * -vz) / vl2;
            const gamma = 1 / Math.sqrt(1 - beta * beta);
            const dop = 1 / (gamma * (1 - beta * cosT));
            const grav = Math.sqrt(Math.max(0.05, 1 - HORIZON / rc));
            const temp = Math.pow(R_IN / rc, 0.75) * Math.pow(Math.max(0, 1 - Math.sqrt(R_IN * 0.9 / rc)), 0.25);
            m.boost[i] = temp * Math.pow(dop * grav, 2.5);
            break;
          }
          crossings++;
        }
      }
      m.kind[i] = kind;
      if (kind === SKY) {
        const l = Math.hypot(vx, vy, vz);
        m.dx[i] = vx / l; m.dy[i] = vy / l; m.dz[i] = vz / l;
      }
    }
  }
  return m;
}

/**
 * A black hole with a glowing accretion disk. The disk's far side is lensed into arcs over and
 * under the shadow, a thin photon ring hugs the edge, the approaching side burns brighter, and
 * background stars smear into arcs as they drift behind it.
 */
const blackhole: SceneDef = {
  id: 'blackhole',
  name: 'Event Horizon',
  family: 'scenic',
  blurb: 'A lensed accretion disk around a black hole',
  recommended: { style: 'firelight' },
  defaultSeed: 1915,
  params: [
    { key: 'spin', label: 'Disk speed', min: 0.1, max: 3, default: 1 },
    { key: 'tilt', label: 'Tilt', min: 0.02, max: 0.6, default: 0.13 },
    { key: 'turbulence', label: 'Turbulence', min: 0, max: 1, default: 0.6 },
    { key: 'jets', label: 'Jets', min: 0, max: 1, default: 0 },
  ],
  create() {
    let cols = 0, rows = 0, aspect = 0.6;
    let map: LensMap | null = null;
    let mapTilt = -1, pendingTilt = -1, tiltWait = 0;
    let t = 0, spinT = 0, glow = 0, hotspot = -1, hotPhi = 0;
    const rgb: [number, number, number] = [0, 0, 0];

    return {
      init(ctx) {
        cols = ctx.cols; rows = ctx.rows; aspect = ctx.aspect;
        map = traceMap(cols, rows, aspect, ctx.params.tilt);
        mapTilt = ctx.params.tilt;
        t = ctx.rng() * 100;
        hotspot = -1;
      },
      update(dt, audio, ctx) {
        t += dt;
        spinT += dt * ctx.params.spin;
        glow += (audio.level * 0.3 + audio.beat * 0.15 - glow) * Math.min(1, dt * 3);
        // Re-trace when the tilt changes, but only once the slider settles.
        if (ctx.params.tilt !== mapTilt) {
          if (ctx.params.tilt !== pendingTilt) { pendingTilt = ctx.params.tilt; tiltWait = 0.3; }
          tiltWait -= dt;
          if (tiltWait <= 0) {
            map = traceMap(cols, rows, aspect, ctx.params.tilt);
            mapTilt = ctx.params.tilt;
          }
        }
        if (hotspot >= 0) {
          hotspot += dt;
          if (hotspot > 45) hotspot = -1;
        }
      },
      event(ctx) {
        // A hot spot flares in the inner disk and orbits, lensed on every pass.
        hotspot = 0;
        hotPhi = ctx.rng() * Math.PI * 2;
      },
      render(grid, ctx) {
        if (!map) return;
        const { noise } = ctx;
        const V = grid.v, C = grid.col;
        const turb = ctx.params.turbulence;
        const omega0 = 2.6; // inner disk turns about once every 10 s at speed 1
        // two texture layers, crossfaded, each reset while invisible so shear never runs away
        const tau0 = spinT % LAYER_PERIOD, tau1 = (spinT + LAYER_PERIOD / 2) % LAYER_PERIOD;
        const w0 = Math.sin((Math.PI * tau0) / LAYER_PERIOD) ** 2;
        const z0 = Math.floor(spinT / LAYER_PERIOD) * 3.1, z1 = Math.floor((spinT + LAYER_PERIOD / 2) / LAYER_PERIOD) * 3.1 + 17;
        const hotEnv = hotspot >= 0 ? smoothstep(0, 4, hotspot) * smoothstep(45, 35, hotspot) : 0;
        const drift = t * 0.004;
        const cd = Math.cos(drift), sd = Math.sin(drift);
        const { kind, r: R, phi: PHI, boost, order, dx: DX, dy: DY, dz: DZ, b: B } = map;
        const n = cols * rows;
        for (let i = 0; i < n; i++) {
          const c = i * 3;
          const k = kind[i];
          if (k === DISK) {
            const r = R[i];
            const om = omega0 * Math.pow(R_IN / r, 1.5);
            const p0 = PHI[i] - om * tau0, p1 = PHI[i] - om * tau1;
            const s = r * 0.42;
            const n0 = noise.n3(Math.cos(p0) * s, Math.sin(p0) * s, z0 + r * 0.15);
            const n1 = noise.n3(Math.cos(p1) * s, Math.sin(p1) * s, z1 + r * 0.15);
            const tex = n0 * w0 + n1 * (1 - w0);
            const bands = 0.5 + 0.5 * Math.sin(r * 2.4 + tex * 3);
            let b = boost[i] * (1 - turb * 0.55 + turb * (0.35 * bands + 0.45 * (0.5 + tex)));
            if (hotEnv > 0) {
              let dphi = PHI[i] - (hotPhi + omega0 * Math.pow(R_IN / 4.5, 1.5) * spinT);
              dphi = Math.atan2(Math.sin(dphi), Math.cos(dphi));
              b += hotEnv * 1.4 * Math.exp(-((r - 4.5) ** 2) / 0.6 - (dphi * dphi) / 0.12);
            }
            b *= (order[i] ? 0.85 : 1) * (1 + glow);
            const v = clamp(1 - Math.exp(-b * 1.6));
            V[i] = v;
            fireColor(0.35 + v * 0.75, rgb);
            // the hottest, fastest-approaching gas shades toward blue-white
            const blue = clamp((boost[i] - 0.9) * 0.6);
            C[c] = rgb[0] + (0.85 - rgb[0]) * blue; C[c + 1] = rgb[1] + (0.9 - rgb[1]) * blue; C[c + 2] = rgb[2] + (1 - rgb[2]) * blue;
          } else if (k === SKY) {
            // background sky drifts slowly, so stars slide behind the hole and smear into arcs
            const ddx = DX[i] * cd - DZ[i] * sd, ddz = DX[i] * sd + DZ[i] * cd;
            const lon = Math.atan2(ddz, ddx), lat = Math.asin(clamp(DY[i], -1, 1));
            // stars are points jittered inside angular bins; lensing stretches them into arcs
            const bin = 0.03;
            const qx = Math.floor(lon / bin), qy = Math.floor(lat / bin);
            let v = 0;
            if (hash2(qx, qy, 1915) < 0.12) {
              const sx = (qx + hash2(qx, qy, 3)) * bin, sy = (qy + hash2(qx, qy, 4)) * bin;
              const dl = (lon - sx) * Math.cos(lat), dt = lat - sy;
              const d = Math.sqrt(dl * dl + dt * dt);
              v = (0.3 + 0.65 * hash2(qy, qx, 7)) * Math.exp(-((d / 0.006) ** 2));
            }
            v += Math.max(0, noise.n3(ddx * 1.6, DY[i] * 1.6, ddz * 1.6)) * 0.05;
            V[i] = clamp(v);
            C[c] = 0.85; C[c + 1] = 0.88; C[c + 2] = 1;
          } else {
            V[i] = 0;
          }
          // the photon ring: light that orbited the hole before escaping, a thin bright circle
          if (k !== DISK || order[i]) {
            const ring = Math.exp(-(((B[i] - 5.196) / 0.22) ** 2)) * 0.8;
            if (ring > V[i]) {
              V[i] = ring;
              C[c] = 1; C[c + 1] = 0.82; C[c + 2] = 0.6;
            }
          }
        }
        // relativistic jets along the spin axis, with knots streaming outward
        const jets = ctx.params.jets;
        if (jets > 0.01) {
          const cx = cols / 2, cy = rows / 2;
          for (let y = 0; y < rows; y++) {
            const d = Math.abs(y - cy);
            if (d < rows * 0.12) continue;
            const w = 0.6 + d * 0.05;
            const knots = 0.6 + 0.4 * noise.n2(d * 0.25 - t * 3, y < cy ? 1 : 2);
            for (let x = Math.floor(cx - w * 3 / aspect); x <= cx + w * 3 / aspect; x++) {
              const dx = (x - cx) * aspect;
              const b = jets * 0.45 * knots * Math.exp(-(dx * dx) / (w * w)) * Math.exp(-d / (rows * 0.6));
              if (b > 0.02) grid.max(x, y, b, 0.6, 0.7, 1);
            }
          }
        }
      },
    };
  },
};

export default blackhole;
