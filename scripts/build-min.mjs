import { rolldown } from '/Users/khorozhanov/Documents/dev/rolldown/packages/rolldown/dist/index.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const b = await rolldown({ input: join(root, 'generated/index.js'), logLevel: 'silent' });
const o = await b.generate({ format: 'esm', minify: true });
await b.close();
console.log('output=' + o.output[0].code.length + 'b');
