import { execSync } from 'node:child_process';

const PORTS = [3000, 24678];

function safeExec(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function getListeningPidsWindows(port) {
  const output = safeExec(`netstat -ano -p tcp | findstr :${port}`);
  if (!output) return [];

  const pids = new Set();
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) continue;

    const localAddress = parts[1] || '';
    const state = parts[3] || '';
    const pid = parts[4] || '';

    if (!localAddress.endsWith(`:${port}`)) continue;
    if (state.toUpperCase() !== 'LISTENING') continue;
    if (/^\d+$/.test(pid)) pids.add(pid);
  }

  return [...pids];
}

function getListeningPidsUnix(port) {
  const output = safeExec(`lsof -ti tcp:${port}`);
  if (!output) return [];
  return output
    .split(/\r?\n/)
    .map((v) => v.trim())
    .filter((v) => /^\d+$/.test(v));
}

function killPid(pid) {
  if (process.platform === 'win32') {
    safeExec(`taskkill /F /PID ${pid}`);
    return;
  }
  safeExec(`kill -9 ${pid}`);
}

for (const port of PORTS) {
  const pids = process.platform === 'win32'
    ? getListeningPidsWindows(port)
    : getListeningPidsUnix(port);

  if (pids.length === 0) continue;

  for (const pid of pids) {
    killPid(pid);
    console.log(`[free-ports] Killed PID ${pid} on port ${port}`);
  }
}
