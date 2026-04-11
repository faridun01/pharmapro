import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const prismaClientDir = path.join(projectRoot, 'node_modules', '.prisma', 'client');

const requiredClientFiles = [
  path.join(prismaClientDir, 'index.js'),
  path.join(prismaClientDir, 'query_engine-windows.dll.node'),
];

const hasExistingClient = () => requiredClientFiles.every((filePath) => fs.existsSync(filePath));

try {
  const output = execSync('npx prisma generate', {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (output) {
    process.stdout.write(output);
  }
} catch (error) {
  const message = [error?.message, error?.stdout?.toString?.(), error?.stderr?.toString?.()]
    .filter(Boolean)
    .join('\n');

  const isWindowsEngineRenameLock =
    message.includes('EPERM: operation not permitted, rename') &&
    message.includes('query_engine-windows.dll.node');

  if (isWindowsEngineRenameLock && hasExistingClient()) {
    if (error?.stdout) {
      process.stdout.write(error.stdout.toString());
    }
    if (error?.stderr) {
      process.stderr.write(error.stderr.toString());
    }
    console.warn('[prisma-generate-safe] Prisma generate hit a Windows file lock, but an existing client and query engine are already present.');
    console.warn('[prisma-generate-safe] Continuing the build with the existing generated client. If you changed prisma/schema.prisma, stop PharmaPro processes and rerun prisma generate manually.');
    process.exit(0);
  }

  throw error;
}