#!/usr/bin/env node

// CLI entrypoint used to build the Factur-X PDF examples in examples/.
// Example: node bin/facturx.mjs batch examples --out-dir examples/out

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const distCli = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');
if (!existsSync(distCli)) {
  process.stderr.write('facturx: dist/cli.js not found — run "npm run build" first\n');
  process.exit(2);
}
const { main } = await import(distCli);
process.exit(await main(process.argv.slice(2)));
