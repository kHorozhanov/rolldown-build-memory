import { rolldown } from '/Users/khorozhanov/Documents/dev/rolldown/packages/rolldown/dist/index.mjs';
import { writeFileSync } from 'node:fs';

const lazy = process.argv[2] === 'lazy';
const outFile = process.argv[3] ?? null;

const bundle = await rolldown({
  input: './generated/index.js',
  experimental: lazy ? { lazyBarrel: true } : {},
});
const { output } = await bundle.generate({ format: 'esm' });
await bundle.close();

const code = output.map((c) => (c.type === 'chunk' ? c.code : '')).join('\n');
if (outFile) writeFileSync(outFile, code);
console.error(`lazy=${lazy} chunks=${output.length} bytes=${code.length}`);
