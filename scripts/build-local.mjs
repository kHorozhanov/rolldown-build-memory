import { rolldown } from '/Users/khorozhanov/Documents/dev/rolldown/packages/rolldown/dist/index.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lb = process.env.LB === '1';
const b = await rolldown({ input: join(root, 'generated/index.js'), logLevel: 'silent', experimental: { lazyBarrel: lb } });
const o = await b.generate({ format: 'esm' });
await b.close();
console.log(`local rolldown lazyBarrel=${lb} output=${o.output[0].code.length}b`);
