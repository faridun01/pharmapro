import { execSync } from 'node:child_process';

function safeExec(command) {
  try {
    execSync(command, { stdio: 'inherit' });
  } catch {
    // Keep going: this script is best-effort cleanup before packaging.
  }
}

safeExec('node ./scripts/free-electron.mjs');
safeExec('node ./scripts/free-prisma-lock.mjs');
safeExec('npx rimraf release/win-unpacked');