import { clamp, type RGB } from '../../engine/math';

/** Code point of a single character, for glyph hints. */
export const cp = (c: string) => c.codePointAt(0)!;

const DASH = cp('-'), BAR = cp('|'), SLASH = cp('/'), BACK = cp('\\');

/**
 * The line glyph that best follows a direction given in cells (y grows downward).
 * `aspect` is cell width / height, so directions are judged in square units.
 */
export function lineGlyph(dx: number, dy: number, aspect: number): number {
  const ax = Math.abs(dx * aspect), ay = Math.abs(dy);
  if (ay < ax * 0.4) return DASH;
  if (ax < ay * 0.4) return BAR;
  return dx * aspect * dy > 0 ? BACK : SLASH;
}

/** Blackbody-ish ramp: dark red -> orange -> yellow -> white. */
export function fireColor(t: number, out: RGB): RGB {
  t = clamp(t);
  out[0] = clamp(0.35 + t * 2.2);
  out[1] = clamp((t - 0.22) * 1.55);
  out[2] = clamp((t - 0.7) * 2.2);
  return out;
}

/** A gentle single-pulse envelope: smooth rise, exponential decay. Never strobes. */
export function pulse(age: number, rise: number, decay: number): number {
  if (age < 0) return 0;
  if (age < rise) {
    const k = age / rise;
    return k * k * (3 - 2 * k);
  }
  return Math.exp(-(age - rise) / decay);
}
