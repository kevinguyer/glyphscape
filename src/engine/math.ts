export const TAU = Math.PI * 2;

export const clamp = (v: number, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
export const fract = (x: number) => x - Math.floor(x);

/** Exponential smoothing factor for a time constant, frame-rate independent. */
export const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const v = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  const c = (x: number) => Math.round(clamp(x) * 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** h in [0,1), s,v in [0,1]. Writes into out. */
export function hsv(h: number, s: number, v: number, out: RGB = [0, 0, 0]): RGB {
  h = fract(h) * 6;
  const i = Math.floor(h);
  const f = h - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  switch (i) {
    case 0: out[0] = v; out[1] = t; out[2] = p; break;
    case 1: out[0] = q; out[1] = v; out[2] = p; break;
    case 2: out[0] = p; out[1] = v; out[2] = t; break;
    case 3: out[0] = p; out[1] = q; out[2] = v; break;
    case 4: out[0] = t; out[1] = p; out[2] = v; break;
    default: out[0] = v; out[1] = p; out[2] = q; break;
  }
  return out;
}

/** Sample a multi-stop gradient (stops evenly spaced) at t in [0,1]. */
export function sampleGradient(stops: RGB[], t: number, out: RGB = [0, 0, 0]): RGB {
  if (stops.length === 1) {
    out[0] = stops[0][0]; out[1] = stops[0][1]; out[2] = stops[0][2];
    return out;
  }
  const x = clamp(t) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i], b = stops[i + 1];
  out[0] = lerp(a[0], b[0], f);
  out[1] = lerp(a[1], b[1], f);
  out[2] = lerp(a[2], b[2], f);
  return out;
}

// --- Fast table approximations for hot per-cell loops ---

const SIN_N = 4096;
const SIN_TAB = Float32Array.from({ length: SIN_N }, (_, i) => Math.sin((i / SIN_N) * TAU));
const SIN_K = SIN_N / TAU;
/** Table sine, ~0.0015 max error. */
export const fsin = (x: number) => SIN_TAB[((x * SIN_K) | 0) & (SIN_N - 1)];
export const fcos = (x: number) => SIN_TAB[(((x * SIN_K) | 0) + SIN_N / 4) & (SIN_N - 1)];

const EXP_N = 2048, EXP_MIN = -16;
const EXP_TAB = Float32Array.from({ length: EXP_N + 1 }, (_, i) => Math.exp(EXP_MIN + (i / EXP_N) * -EXP_MIN));
const EXP_K = EXP_N / -EXP_MIN;
/** Table exp for x <= 0 (returns ~0 below -16). Linear interpolation. */
export function fexp(x: number) {
  if (x >= 0) return x === 0 ? 1 : Math.exp(x);
  if (x <= EXP_MIN) return 0;
  const f = (x - EXP_MIN) * EXP_K;
  const i = f | 0;
  return EXP_TAB[i] + (EXP_TAB[i + 1] - EXP_TAB[i]) * (f - i);
}
