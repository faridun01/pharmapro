import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

const args = process.argv.slice(2);

const getArgValue = (flag) => {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] ?? null;
};

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: npm run bootstrap:admin -- --username owner --password <password> --name "Owner" --role OWNER [--email owner@example.com] [--env .env.production]');
  process.exit(0);
}

const envOverride = getArgValue('--env');
const envCandidates = [
  envOverride ? path.resolve(projectRoot, envOverride) : null,
  path.join(projectRoot, '.env.production.local'),
  path.join(projectRoot, '.env.production'),
  path.join(projectRoot, '.env'),
].filter(Boolean);

for (const envFile of envCandidates) {
  if (!fs.existsSync(envFile)) continue;
  const result = dotenv.config({ path: envFile, override: false });
  if (!result.error) {
    break;
  }
}

const email = String(getArgValue('--email') || '').trim().toLowerCase();
const password = String(getArgValue('--password') || '').trim();
const name = String(getArgValue('--name') || 'Admin').trim();
const username = String(getArgValue('--username') || email.split('@')[0] || 'admin').trim().toLowerCase();
const roleRaw = String(getArgValue('--role') || 'ADMIN').trim().toUpperCase();
const validRoles = new Set(['OWNER', 'ADMIN']);

if (!username || !password) {
  console.error('[bootstrap-admin] --username and --password are required.');
  process.exit(1);
}

if (password.length < 8) {
  console.error('[bootstrap-admin] Password must be at least 8 characters long.');
  process.exit(1);
}

if (!validRoles.has(roleRaw)) {
  console.error('[bootstrap-admin] --role must be OWNER or ADMIN.');
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('[bootstrap-admin] DATABASE_URL is not configured.');
  process.exit(1);
}

const prisma = new PrismaClient();

try {
  const passwordHash = await bcrypt.hash(password, 10);
  const existing = await prisma.user.findUnique({
    where: { username },
    select: { id: true },
  });

  const data = {
    username,
    password: passwordHash,
    name,
    role: roleRaw,
    isActive: true,
  };

  if (existing) {
    await prisma.user.update({
      where: { username },
      data,
    });
    console.log(`[bootstrap-admin] Updated ${roleRaw} user: ${username}`);
  } else {
    await prisma.user.create({ data });
    console.log(`[bootstrap-admin] Created ${roleRaw} user: ${username}`);
  }
} finally {
  await prisma.$disconnect();
}
