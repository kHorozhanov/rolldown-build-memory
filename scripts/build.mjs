// Bundle generated/index.js with the chosen bundler. Run this UNDER an external
// peak-RSS meter (see matrix.sh) — rolldown does its heavy allocation in a native
// (Rust) addon inside this process, so OS-level RSS captures it while
// process.memoryUsage() (V8 heap only) does not.
//
//   node scripts/build.mjs <rolldown|esbuild>
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const input = join(root, 'generated', 'index.js');
const bundler = process.argv[2] ?? 'rolldown';
const t0 = Date.now();

if (bundler === 'rolldown') {
  const { rolldown } = await import('rolldown');
  const bundle = await rolldown({ input, logLevel: 'silent' });
  await bundle.generate({ format: 'esm' });
  await bundle.close();
} else if (bundler === 'esbuild') {
  const esbuild = await import('esbuild');
  await esbuild.build({ entryPoints: [input], bundle: true, format: 'esm', write: false, logLevel: 'silent' });
} else {
  throw new Error(`unknown bundler: ${bundler}`);
}

console.log(`${bundler} bundled in ${Date.now() - t0}ms`);
