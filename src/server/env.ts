/**
 * MUST be the FIRST import in prodServer.ts.
 *
 * In the esbuild bundle, module-level code from imported modules is inlined
 * before the entry point's own code. This means `new PrismaClient()` (in
 * prisma.ts, imported transitively via createApp) would run BEFORE the
 * `dotenv.config()` call in prodServer.ts, leaving DATABASE_URL undefined.
 *
 * By putting dotenv.config() here and importing this file first, it runs
 * before any other module's initialization code.
 */
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';

const currentDir =
  typeof __dirname !== 'undefined'
    ? __dirname
    : path.dirname(process.argv[1] || process.cwd());
const processWithResources = process as NodeJS.Process & { resourcesPath?: string };

const unique = <T>(values: T[]) => [...new Set(values)];

// Load from lowest priority to highest priority so user-saved DB settings
// override bundled defaults without discarding required shared keys.
const candidates = unique([
  processWithResources.resourcesPath ? path.join(processWithResources.resourcesPath, '.env') : null,
  path.join(currentDir, '../../.env'),
  path.join(process.cwd(), '.env'),
  process.env.APPDATA ? path.join(process.env.APPDATA, 'pharmapro', '.env') : null,
  process.platform === 'darwin' ? path.join(process.env.HOME || '', 'Library/Application Support', 'pharmapro', '.env') : null,
  process.env.PHARMAPRO_ENV_FILE,
].filter(Boolean) as string[]);

for (const p of candidates) {
  if (!fs.existsSync(p)) continue;
  dotenv.config({ path: p, override: true });
}
