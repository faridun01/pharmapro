import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const outputDir = path.join(projectRoot, 'build', 'runtime');
const outputFile = path.join(outputDir, '.env');

const sourceCandidates = [
  path.join(projectRoot, '.env.production.local'),
  path.join(projectRoot, '.env.production'),
];

const sourceFile = sourceCandidates.find((candidate) => fs.existsSync(candidate));

if (!sourceFile) {
  console.error('[prepare-runtime-env] Missing .env.production or .env.production.local');
  console.error('[prepare-runtime-env] Create a dedicated production env file instead of packaging the local development .env.');
  process.exit(1);
}

const sourceText = fs.readFileSync(sourceFile, 'utf8');
const lines = sourceText.split(/\r?\n/);
const filteredLines = lines.filter((line) => !/^\s*ALLOW_DEV_AUTH_BYPASS\s*=/.test(line));

const envMap = new Map();
for (const line of filteredLines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const separatorIndex = trimmed.indexOf('=');
  if (separatorIndex === -1) continue;
  const key = trimmed.slice(0, separatorIndex).trim();
  let value = trimmed.slice(separatorIndex + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  envMap.set(key, value);
}

const databaseUrl = envMap.get('DATABASE_URL') || '';
const jwtSecret = envMap.get('JWT_SECRET') || '';

if (!databaseUrl || databaseUrl.includes('replace-with')) {
  console.error('[prepare-runtime-env] DATABASE_URL must be set in the production env file.');
  process.exit(1);
}

if (!jwtSecret || jwtSecret.includes('replace-with') || jwtSecret.length < 32) {
  console.error('[prepare-runtime-env] JWT_SECRET must be set to a real production secret (32+ characters).');
  process.exit(1);
}

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputFile, `${filteredLines.join('\n').trim()}\n`, 'utf8');

console.log(`[prepare-runtime-env] Using ${path.basename(sourceFile)} -> build/runtime/.env`);