import { build } from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

await build({
  entryPoints: [path.join(projectRoot, 'src', 'server', 'prodServer.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  minify: true,
  keepNames: true,
  outfile: path.join(projectRoot, 'dist-server', 'server.cjs'),
});

// Copy Prisma query engine binary alongside server.cjs.
// In the packaged Electron app (asarUnpacked), main.cjs sets
// PRISMA_QUERY_ENGINE_LIBRARY to this path so Prisma can locate it.
const prismaClientDir = path.join(projectRoot, 'node_modules', '.prisma', 'client');
const distServerDir = path.join(projectRoot, 'dist-server');

let binariesCopied = 0;
try {
  const files = fs.readdirSync(prismaClientDir).filter(f => f.endsWith('.node'));
  for (const file of files) {
    fs.copyFileSync(path.join(prismaClientDir, file), path.join(distServerDir, file));
    console.log(`[build-server] Prisma binary copied: ${file}`);
    binariesCopied++;
  }
} catch (err) {
  console.warn(`[build-server] Could not copy Prisma binaries: ${err.message}`);
  console.warn('[build-server] Run "npx prisma generate" first if this is unexpected.');
}

if (binariesCopied === 0) {
  console.warn('[build-server] No Prisma binaries found — database may not work in packaged app.');
}
