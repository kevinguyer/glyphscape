import { drawLayer, FramePlayer, placeArt, type FrameAnim } from '../engine/frames';
import { clamp } from '../engine/math';
import type { SceneDef } from '../engine/types';
import { cp, fireColor } from './kit';

const W = 72;
const pad = (s: string, w = W) => (s.length >= w ? s.slice(0, w) : s + ' '.repeat(w - s.length));
const at = (col: number, s: string) => pad(' '.repeat(col) + s);

// --- The authored base: a brick fireplace with a mantle, candles, a painting and a sleeping cat ---
const PIC_X = 21, PIC_W = 26;
const pic = (inner: string) => at(PIC_X, '|' + pad(inner, PIC_W) + '|');

const OPEN_L = 17, OPEN_R = 54; // firebox opening, inclusive columns
const BRICK_TOP = 13, OPEN_TOP = 15, OPEN_BOT = 24;

function brickRow(r: number, withOpening: boolean) {
  let s = '  ||';
  for (let c = 4; c < 68; c++) {
    if (withOpening && c >= OPEN_L && c <= OPEN_R) {
      s += ' ';
      continue;
    }
    if (withOpening && (c === OPEN_L - 1 || c === OPEN_R + 1)) {
      s += r === OPEN_TOP ? (c < OPEN_L ? '/' : '\\') : '|';
      continue;
    }
    s += (c + (r % 2) * 3) % 6 === 0 ? '|' : '_';
  }
  return pad(s + '||');
}

function buildBase(): string[] {
  const rows: string[] = [];
  rows.push(at(PIC_X, '.' + '-'.repeat(PIC_W) + '.'));
  rows.push(pic('   .     /\\         *    '));
  rows.push(pic('        /  \\   /\\        '));
  rows.push(pic('   /\\  /    \\_/  \\_      '));
  rows.push(pic('__/  \\/____________\\___  '));
  rows.push(at(PIC_X, "'" + '-'.repeat(PIC_W) + "'"));
  rows.push(at(6, ',') .slice(0, 64) + pad(',', 8));
  rows.push(pad('     |~|                  ___   _   __                         |~|'));
  rows.push(pad('     | |                 |   | | | |  |   .-.                  | |'));
  rows.push(pad('     |_|                 |___| |_| |__|  (___)                 |_|'));
  rows.push(pad('  ' + '_'.repeat(66)));
  rows.push(pad(' |' + '_'.repeat(66) + '|'));
  rows.push(pad('  \\' + '_'.repeat(64) + '/'));
  for (let r = BRICK_TOP; r <= OPEN_BOT; r++) rows.push(brickRow(r, r >= OPEN_TOP));
  rows.push(pad(' __||' + '_'.repeat(62) + '||__'));
  rows.push(pad('|' + '_'.repeat(70) + '|'));
  rows.push(at(50, '  /\\_/\\'));
  rows.push(at(50, ' ( -.- )___'));
  rows.push(at(50, '  (__)(__)_)~'));
  return rows;
}

// Logs and grate, drawn inside the opening over the base.
const LOGS = [
  '      ___________      _________        ',
  '  ___(___________)____(_________)___    ',
  ' /__________________________________\\   ',
].map((s) => pad(s, 38));
const LOGS_X = OPEN_L, LOGS_Y = OPEN_BOT - 2;

// Hand-authored flame frames (34 x 8), looped with uneven timing.
const FLAMES: string[][] = [
  [
    '              ,          \'        ',
    '         \'   /(     ,   ( \\       ',
    '        /(  ( ;\\   /(    ) )  ,   ',
    '   ,   ( ;\\  ) ) ( \' )  ( (  /(   ',
    '  /(   )\' )( ( (  ) ( \\  ) )( ;)  ',
    ' ( ;) ( ( ( \\ ) )( ( ) )( ( )\\ (  ',
    '  ) )( ) ) ) ( ( )\\ ) ( ) )( ) )  ',
    ' (_(_(_)(_(_)_)_)_(_)_)(_(_(_)(_) ',
  ],
  [
    '          \'          ,            ',
    '     ,   ( \\    \'   /(      \'     ',
    '    /(    ) )  /(  ( ;\\    / (    ',
    '   ( ;\\  ( (  ( \'\\  ) )   ( \' )   ',
    '    ) )\\  ) )( ( ( ( (  ,  ) ( \\  ',
    '   ( ( )( ( ( ) ) ) ) )/( ( ( ) ) ',
    '  ( ) )( ) )( ( (\\ )( (  ) )( ( ( ',
    ' (_)(_(_(_)_(_)_)_)(_)_)(_)(_(_)_)',
  ],
  [
    '                  ,       ,       ',
    '       ,     \'   /(      ( \\      ',
    '      /(   /(   ( \'\\   ,  ) )     ',
    '     ( ;\\ ( ;)   ) )  /( ( (  ,   ',
    '  ,   ) )  ) )( ( ( ( \' ) ) )/(   ',
    ' /(  ( ( )( ( ) ) )\\ ) ( ( ( ;)   ',
    '( ;\\  ) )( ) )( ( ( ( ) ) )( ) )  ',
    ' (_(_(_)_)(_(_)_)(_)_)(_(_(_)(_)  ',
  ],
  [
    '        ,              \'          ',
    '       ( \\     ,      /(    ,     ',
    '   \'    ) )   /(     ( ;\\  /(     ',
    '  /(   ( (   ( \'\\  ,  ) )( \'\\  \'  ',
    ' ( \'\\   ) )\\  ) ) /(  ( ( ) ) /(  ',
    '  ) )( ( ( )( ( ( ;\\ ) ) )( ( ;)  ',
    ' ( ( ) ) ) ( ) ) ) )( ( ( ) ) ( ( ',
    ' (_(_)(_(_(_)_(_)_)(_)(_(_)_)(_)_)',
  ],
].map((f) => f.map((r) => pad(r, 34)));

export const HEARTH_ANIM: FrameAnim = {
  width: W,
  height: 30,
  base: buildBase(),
  frames: FLAMES.map((rows, i) => ({ rows, ms: [140, 120, 160, 130][i] })),
  frameX: OPEN_L + 2,
  frameY: OPEN_TOP,
};


/** A looping frame-by-frame fireplace with generative flicker layered on top. */
const hearth: SceneDef = {
  id: 'hearth',
  name: 'Hearth',
  family: 'hand-authored',
  blurb: 'A hand-drawn fireplace with living flicker',
  recommended: { style: 'firelight' },
  defaultSeed: 4410,
  params: [
    { key: 'speed', label: 'Flicker speed', min: 0.3, max: 2, default: 1 },
    { key: 'warmth', label: 'Fire glow', min: 0, max: 1, default: 0.6 },
    { key: 'room', label: 'Room light', min: 0, max: 1, default: 0.5 },
  ],
  create() {
    const player = new FramePlayer(HEARTH_ANIM);
    let t = 0, fire = 1, pulse = 0, catAwake = -1;
    const rgb: [number, number, number] = [0, 0, 0];
    return {
      init(ctx) {
        t = ctx.rng() * 100;
      },
      update(dt, audio, ctx) {
        t += dt;
        player.speed = ctx.params.speed;
        player.update(dt);
        // slow, organic brightness wander (never faster than a few tenths of a hertz)
        const n = ctx.noise.n2(t * 0.35 * ctx.params.speed, 1.7) * 0.5 + ctx.noise.n2(t * 1.1, 9.1) * 0.15;
        fire = 0.82 + n * 0.3;
        pulse = Math.max(pulse * Math.exp(-dt * 3), audio.beat);
        if (catAwake >= 0) {
          catAwake += dt;
          if (catAwake > 25) catAwake = -1;
        }
      },
      event() {
        catAwake = 0;
      },
      render(grid, ctx) {
        const { cols, rows, noise } = ctx;
        const anim = HEARTH_ANIM;
        const pl = placeArt(cols, rows, anim.width, anim.height);
        const glowAmt = ctx.params.warmth;
        const roomAmt = ctx.params.room;
        const F = fire + pulse * 0.25;
        const fx = (OPEN_L + OPEN_R) / 2, fy = OPEN_BOT - 2;
        const V = grid.v, C = grid.col, G = grid.glyph;

        // Room: dark walls washed by firelight from below
        const scale = typeof pl.scale === 'number' ? pl.scale : 1;
        const gfx = pl.ox + fx * scale, gfy = pl.oy + fy * scale;
        const reach = Math.max(cols, rows * 2);
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const dx = (x - gfx) * ctx.aspect, dy = (y - gfy) * 1.3;
            const d = Math.sqrt(dx * dx + dy * dy) / reach;
            const v = clamp(0.11 - d * 0.22) * F * roomAmt;
            if (v <= 0.004) continue;
            const i = y * cols + x;
            V[i] = v;
            C[i * 3] = 1; C[i * 3 + 1] = 0.55; C[i * 3 + 2] = 0.25;
          }
        }

        const paintBase = (gx: number, gy: number, ch: string, ax: number, ay: number, dens: number) => {
          if (!grid.inside(gx, gy)) return;
          const i = gy * cols + gx;
          // distance from the fire in art units, for light falloff
          const ddx = (ax - fx) * 0.6, ddy = ay - fy;
          const near = clamp(1 - Math.sqrt(ddx * ddx + ddy * ddy) / 30);
          let lit = 0.4 + 0.8 * near * F * (0.5 + glowAmt * 0.5);
          let r = 0.62, g = 0.3, b = 0.22; // brick
          if (ay < 6) { r = 0.65; g = 0.5; b = 0.35; if (ay > 0 && ay < 5 && ax > PIC_X && ax < PIC_X + PIC_W + 1) { r = 0.55; g = 0.68; b = 0.85; } }
          else if (ay < 10) {
            r = 0.95; g = 0.9; b = 0.75;
            if (ch === ',') {
              // candle flames: their own tiny flicker
              const fl = 0.75 + 0.25 * noise.n2(t * 1.3 + ax, 4);
              fireColor(0.75 + 0.2 * fl, rgb);
              V[i] = clamp(0.75 * fl);
              G[i] = pl.native ? cp(fl > 0.85 ? '\'' : ',') : 0;
              C[i * 3] = rgb[0]; C[i * 3 + 1] = rgb[1]; C[i * 3 + 2] = rgb[2];
              return;
            }
            if (ax > 20 && ax < 40) { r = 0.55; g = 0.42; b = 0.5; }
            lit = 0.3 + 0.4 * near * F;
          } else if (ay < BRICK_TOP) { r = 0.68; g = 0.42; b = 0.24; }
          else if (ay > OPEN_BOT + 2) { r = 0.78; g = 0.74; b = 0.7; lit = catAwake >= 0 ? 0.7 : 0.45 + 0.2 * near * F; }
          else if (ay > OPEN_BOT) { r = 0.62; g = 0.6; b = 0.58; }
          V[i] = clamp(Math.pow(dens, 0.7) * lit);
          G[i] = pl.native ? cp(ch) : 0;
          C[i * 3] = r; C[i * 3 + 1] = g; C[i * 3 + 2] = b;
        };
        if (anim.base) drawLayer(grid, anim.base, pl, 0, 0, paintBase);

        // Cat wakes during the rare event: eyes open, tail flicks
        if (catAwake >= 0 && pl.native) {
          const open = catAwake > 1 && catAwake < 22 && Math.sin(catAwake * 0.8) > -0.9;
          grid.text(pl.ox + 50 + 3, pl.oy + 28, open ? 'o.o' : '-.-', 0.75, 0.85, 0.82, 0.78);
          if (Math.sin(catAwake * 1.4) > 0) grid.text(pl.ox + 50 + 13, pl.oy + 29, '/', 0.6, 0.78, 0.74, 0.7);
        } else if (pl.native) {
          // drifting zZ above the sleeping cat
          const ph = (t % 9) / 9;
          if (ph < 0.6) {
            const a = Math.sin((ph / 0.6) * Math.PI) * 0.45;
            grid.text(pl.ox + 50 + 9, pl.oy + 26 - Math.floor(ph * 3), ph < 0.3 ? 'z' : 'Z', a, 0.8, 0.8, 0.85);
          }
        }

        // Firebox interior glow behind the flames
        for (let ay = OPEN_TOP; ay <= OPEN_BOT; ay++) {
          for (let ax = OPEN_L; ax <= OPEN_R; ax++) {
            const k = typeof pl.scale === 'number' && pl.scale > 1 ? pl.scale : 1;
            const depth = (ay - OPEN_TOP) / (OPEN_BOT - OPEN_TOP);
            const v = (0.04 + 0.16 * depth * depth) * F * (0.5 + glowAmt);
            for (let sy = 0; sy < k; sy++) for (let sx = 0; sx < k; sx++) {
              const gx = pl.native || k > 1 ? pl.ox + ax * k + sx : Math.floor(pl.ox + ax * pl.scale);
              const gy = pl.native || k > 1 ? pl.oy + ay * k + sy : Math.floor(pl.oy + ay * pl.scale);
              if (!grid.inside(gx, gy)) continue;
              const i = gy * cols + gx;
              if (V[i] < v) {
                V[i] = v; G[i] = 0;
                C[i * 3] = 1; C[i * 3 + 1] = 0.4; C[i * 3 + 2] = 0.12;
              }
            }
          }
        }

        // Flames (authored frames) with generative flicker
        const frame = player.frame;
        const top = anim.frameY!, h = frame.rows.length;
        drawLayer(grid, frame.rows, pl, anim.frameX!, top, (gx, gy, ch, ax, ay, dens) => {
          if (!grid.inside(gx, gy)) return;
          const i = gy * cols + gx;
          const rel = clamp((ay - top) / h); // 0 top .. 1 base
          const flick = 0.8 + 0.35 * noise.n3(ax * 0.4, ay * 0.5, t * 2.2 * ctx.params.speed);
          const heat = clamp(0.25 + rel * 0.85 * F * flick + pulse * 0.2);
          fireColor(heat, rgb);
          V[i] = clamp((0.35 + dens * 0.8) * (0.55 + heat * 0.5));
          G[i] = pl.native ? cp(ch) : 0;
          C[i * 3] = rgb[0]; C[i * 3 + 1] = rgb[1]; C[i * 3 + 2] = rgb[2];
        });

        // Logs with glowing undersides
        drawLayer(grid, LOGS, pl, LOGS_X, LOGS_Y, (gx, gy, ch, ax, ay, dens) => {
          if (!grid.inside(gx, gy)) return;
          const i = gy * cols + gx;
          const ember = ch === '_' && ay > LOGS_Y + 0.9 ? 0.4 + 0.3 * noise.n2(ax * 0.5, t * 0.6) : 0;
          if (ember > 0.2) {
            fireColor(0.55 + ember * 0.4, rgb);
            V[i] = clamp(dens * 0.6 + ember * 0.5);
            C[i * 3] = rgb[0]; C[i * 3 + 1] = rgb[1]; C[i * 3 + 2] = rgb[2];
          } else {
            V[i] = clamp(dens * 0.5 * F);
            C[i * 3] = 0.6; C[i * 3 + 1] = 0.36; C[i * 3 + 2] = 0.2;
          }
          G[i] = pl.native ? cp(ch) : 0;
        });
      },
    };
  },
};

export default hearth;
