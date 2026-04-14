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

// Try candidate paths in priority order so the backend finds .env regardless
// of how the exe was launched (from project root, from resources dir, etc.)
const candidates = [
  process.env.PHARMAPRO_ENV_FILE,         // explicit override from Electron main
  path.join(process.cwd(), '.env'),        // inherited CWD
  path.join(currentDir, '../../.env'),     // project root in dev / dist-server in prod
  // Desktop-specific paths
  process.env.APPDATA ? path.join(process.env.APPDATA, 'pharmapro', '.env') : null,
  process.platform === 'darwin' ? path.join(process.env.HOME || '', 'Library/Application Support', 'pharmapro', '.env') : null,
].filter(Boolean) as string[];

for (const p of candidates) {
  if (!fs.existsSync(p)) continue;
  const result = dotenv.config({ path: p, override: false });
  if (!result.error) break;
}
