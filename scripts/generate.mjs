// Generate a synthetic module graph to probe a bundler's build-time memory.
//
//   node scripts/generate.mjs <N> <topology> [used]
//     N        number of leaf modules that exist (default 3000)
//     topology "barrel" (default) | "flat"
//     used     how many leaves the entry actually imports (default N)
//
// N leaves exist on disk. The entry imports a symbol from the first `used` of them:
//
//   flat    entry imports those `used` leaves directly        (entry -> leafI)
//   barrel  entry imports those `used` symbols from a barrel   (entry -> barrel -> leafI)
//           whose `export * from './leafI'` covers ALL N leaves — the dense
//           re-export shape real apps get from index.ts barrels and library
//           barrels (date-fns, react-use, @sentry, ...).
//
// Two probes fall out of this:
//   * used == N  -> every leaf reachable in both topologies. Comparing bundlers
//     isolates per-module build memory (rolldown vs esbuild).
//   * used << N  -> only a few symbols are actually needed. `flat` reaches only
//     `used` leaves; `barrel` must resolve `export *` across all N, so it loads and
//     parses every leaf even though the bundle needs a handful. Comparing barrel vs
//     flat here isolates the cost a re-export barrel imposes for unused members.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const N = Number(process.argv[2] ?? 3000);
const topology = process.argv[3] ?? 'barrel';
const used = Number(process.argv[4] ?? N);
if (!['barrel', 'flat', 'named'].includes(topology)) throw new Error(`topology must be barrel|flat|named, got ${topology}`);
if (used > N) throw new Error(`used (${used}) cannot exceed N (${N})`);

const outDir = join(root, 'generated');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// A leaf module with a non-trivial body, so its parsed AST is representative of a
// real source module rather than a one-liner.
const leaf = (i) => `export const meta${i} = { id: ${i}, tag: ${JSON.stringify('leaf-' + i)}, flags: [${i % 2}, ${i % 3}, ${i % 5}] };
export function compute${i}(input) {
  let acc = 0;
  for (let k = 0; k < 8; k++) {
    acc += (input * ${i} + k) ^ (input << (k % 5));
    if (acc % 7 === 0) acc -= k;
  }
  const label = ${JSON.stringify('x'.repeat(48))};
  return { value: acc, label, id: meta${i}.id };
}
export default compute${i};
`;

for (let i = 0; i < N; i++) writeFileSync(join(outDir, `leaf${i}.js`), leaf(i));

if (topology === 'barrel') {
  let barrel = '';
  for (let i = 0; i < N; i++) barrel += `export * from './leaf${i}.js';\n`;
  writeFileSync(join(outDir, 'barrel.js'), barrel);
  // Declare side-effect-free so `experimental.lazyBarrel` is eligible. On rolldown
  // 1.1.5 this star barrel still loads every target; with rolldown#10394 it defers
  // them (on-demand star probing).
  writeFileSync(join(outDir, 'package.json'), JSON.stringify({ name: 'generated', sideEffects: false }, null, 2));
}
if (topology === 'named') {
  // Named re-export barrel — the react-use / most-libraries shape. Each export is
  // pinned to exactly one module, so `lazy_barrel` *can* defer loading the unused
  // members (unlike `export *`). Requires the barrel to be side-effect-free.
  let barrel = '';
  for (let i = 0; i < N; i++) barrel += `export { compute${i} } from './leaf${i}.js';\n`;
  writeFileSync(join(outDir, 'barrel.js'), barrel);
  // Declare the whole generated package side-effect-free so `lazy_barrel` is eligible.
  writeFileSync(join(outDir, 'package.json'), JSON.stringify({ name: 'generated', sideEffects: false }, null, 2));
}

// The entry references one export from the first `used` leaves. In `flat` only
// those leaves are reachable; in `barrel` the star-re-export forces resolution
// across all N leaves regardless of `used`.
let entry = '';
if (topology === 'barrel' || topology === 'named') {
  const names = Array.from({ length: used }, (_, i) => `compute${i}`);
  entry += `import { ${names.join(', ')} } from './barrel.js';\n`;
} else {
  for (let i = 0; i < used; i++) entry += `import { compute${i} } from './leaf${i}.js';\n`;
}
entry += 'export const total = () => {\n  let s = 0;\n';
for (let i = 0; i < used; i++) entry += `  s += compute${i}(${i}).value;\n`;
entry += '  return s;\n};\n';
writeFileSync(join(outDir, 'index.js'), entry);

console.log(`generated N=${N} leaves (used=${used}), topology=${topology} -> generated/index.js`);
