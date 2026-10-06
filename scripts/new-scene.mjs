// Scaffold a new scene: writes src/scenes/<id>.ts from a working template and registers it in
// the manifest. Usage: npm run new-scene -- <id> ["Display Name"] [family]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const [id, name = '', family = 'procedural'] = process.argv.slice(2);
const FAMILIES = ['procedural', 'particle', 'simulation', 'scenic', 'hand-authored'];

if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) {
  console.error('Usage: npm run new-scene -- <id> ["Display Name"] [family]\n  id: lowercase letters, digits and dashes, e.g. "tide-pools"');
  process.exit(1);
}
if (!FAMILIES.includes(family)) {
  console.error(`family must be one of: ${FAMILIES.join(', ')}`);
  process.exit(1);
}
const file = `src/scenes/${id}.ts`;
if (existsSync(file)) {
  console.error(`${file} already exists`);
  process.exit(1);
}

const varName = id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const display = name || id.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const seed = 1000 + Math.floor(Math.random() * 9000);

const template = `import { clamp } from '../engine/math';
import type { SceneDef } from '../engine/types';
import { cp } from './kit';

/**
 * ${display}: describe what you see here.
 *
 * A scene only writes brightness (0..1), an optional color, and an optional glyph hint into
 * each grid cell. Styles, transitions, audio, the console and thumbnails come for free.
 * See src/scenes/README.md for the full contract and the kit of reusable parts.
 */
const ${varName}: SceneDef = {
  id: '${id}',
  name: '${display}',
  family: '${family}',
  blurb: 'One line for the console',
  recommended: { style: 'green-phosphor' },
  defaultSeed: ${seed},
  params: [
    { key: 'speed', label: 'Speed', min: 0.1, max: 3, default: 1 },
    { key: 'scale', label: 'Scale', min: 0.3, max: 3, default: 1 },
  ],
  create() {
    // All state lives in this closure, so two copies can run at once (transitions, thumbnails).
    let t = 0;
    let pulse = 0;
    return {
      init(ctx) {
        // Called on start and on every resize. Use ctx.rng / ctx.noise, never Math.random,
        // so a seed always recalls the same look.
        t = ctx.rng() * 100;
      },
      update(dt, audio, ctx) {
        t += dt * ctx.params.speed;
        // Audio is a gentle modulation; a silent room must still look good.
        pulse = Math.max(pulse * Math.exp(-dt * 2), audio.beat);
      },
      event() {
        // Optional rare event (about once an hour). Keep it calm: fade in, fade out.
      },
      render(grid, ctx) {
        const { cols, rows, aspect, noise } = ctx;
        const s = 0.03 / ctx.params.scale;
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const n = noise.fbm3(x * aspect * s, y * s, t * 0.05, 3);
            const v = clamp(0.5 + n * 0.9 + pulse * 0.1);
            grid.set(x, y, v * v, 0.4 + 0.6 * v, 0.9, 0.6 + 0.4 * (1 - v));
          }
        }
        // Glyph hints are used by ASCII styles; Braille and Blocks styles use brightness only.
        grid.max(cols / 2, rows / 2, 1, 1, 1, 1, cp('*'));
      },
    };
  },
};

export default ${varName};
`;

writeFileSync(file, template);

// Register in the manifest, ahead of the hidden secret scene.
const manifestPath = 'src/scenes/index.ts';
let manifest = readFileSync(manifestPath, 'utf8');
const imports = [...manifest.matchAll(/^import \w+ from '\.\/[\w-]+';$/gm)];
const last = imports[imports.length - 1];
const at = last.index + last[0].length;
manifest = manifest.slice(0, at) + `\nimport ${varName} from './${id}';` + manifest.slice(at);
manifest = manifest.replace(/(export const SCENES: SceneDef\[\] = \[[\s\S]*?)(probe,\s*\];)/, `$1${varName}, $2`);
if (!manifest.includes(`${varName}, probe`)) {
  console.error(`Wrote ${file}, but couldn't update ${manifestPath}: add ${varName} to SCENES by hand.`);
  process.exit(1);
}
writeFileSync(manifestPath, manifest);
console.log(`Created ${file} and registered it. Run npm run dev, then type "scene ${id}" in the terminal (/).`);
