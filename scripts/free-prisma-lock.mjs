import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

function safeExec(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

function killPidWindows(pid) {
  safeExec('taskkill', ['/F', '/T', '/PID', String(pid)]);
}

function killPidUnix(pid) {
  safeExec('kill', ['-9', String(pid)]);
}

function listWindowsProjectProcesses() {
  const escapedProjectRoot = projectRoot.replace(/\\/g, '\\\\').replace(/'/g, "''");
  const script = [
    "$projectRoot = '" + escapedProjectRoot + "'",
    "$processes = Get-CimInstance Win32_Process | Where-Object {",
    "  ($_.Name -in @('node.exe','electron.exe')) -and",
    "  $_.CommandLine -and",
    "  $_.CommandLine.ToLower().Contains($projectRoot.ToLower())",
    '} | Select-Object ProcessId, Name, CommandLine',
    '$processes | ConvertTo-Json -Compress',
  ].join('; ');

  const output = safeExec('powershell.exe', ['-NoProfile', '-Command', script]).trim();
  if (!output) return [];

  try {
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

function listUnixProjectProcesses() {
  const output = safeExec('ps', ['-axo', 'pid=,command=']);
  if (!output) return [];

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      if (!match) return null;
      return { ProcessId: Number(match[1]), CommandLine: match[2] };
    })
    .filter((entry) => entry && entry.CommandLine.includes(projectRoot))
    .filter((entry) => /node|electron/i.test(entry.CommandLine));
}

const processes = process.platform === 'win32'
  ? listWindowsProjectProcesses()
  : listUnixProjectProcesses();

const currentPid = process.pid;
let killed = 0;

for (const entry of processes) {
  const pid = Number(entry.ProcessId);
  if (!Number.isFinite(pid) || pid === currentPid) continue;

  if (process.platform === 'win32') {
    killPidWindows(pid);
  } else {
    killPidUnix(pid);
  }

  killed += 1;
  console.log(`[free-prisma-lock] Terminated PID ${pid}`);
}

if (killed === 0) {
  console.log('[free-prisma-lock] No PharmaPro Node/Electron processes were holding Prisma files');
}