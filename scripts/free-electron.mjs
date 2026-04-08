import { execSync } from 'node:child_process';

function safeExec(command) {
  try {
    execSync(command, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (process.platform === 'win32') {
  // Kill stale Electron instances that keep single-instance lock in dev.
  safeExec('taskkill /F /IM electron.exe');
  safeExec('taskkill /F /IM PharmaPro.exe');
} else if (process.platform === 'darwin' || process.platform === 'linux') {
  safeExec('pkill -f electron');
  safeExec('pkill -f PharmaPro');
}
