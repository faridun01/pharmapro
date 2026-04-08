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
import dotenv from 'dotenv';

// Try candidate paths in priority order so the backend finds .env regardless
// of how the exe was launched (from project root, from resources dir, etc.)
const candidates = [
  process.env.PHARMAPRO_ENV_FILE,         // explicit override from Electron main
  path.join(process.cwd(), '.env'),        // inherited CWD (works via launch-built.cjs)
  path.join(__dirname, '../../.env'),      // dist-server/../../.env = project root in dev
];

for (const p of candidates) {
  if (!p) continue;
  const result = dotenv.config({ path: p, override: false });
  if (!result.error) break;
}
