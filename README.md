# PharmaPro

Desktop pharmacy management system built with Electron, React, Express, and Prisma.

## Local Development

Prerequisites:

1. Node.js 22+
2. PostgreSQL 15+ running locally or on a reachable host

Setup:

1. Install dependencies:
   `npm install`
2. Create `.env` from `.env.example`
3. Update `DATABASE_URL` with valid PostgreSQL credentials
4. Create the target database if it does not exist
5. Apply the Prisma schema:
   `npx prisma migrate deploy`
6. Start the app:
   `npm run electron:dev`

Useful dev commands:

1. `npm run dev` starts only the local API backend on `3921`
2. `npm run dev:web` starts only the Vite frontend on `3000`
3. `npm run electron:dev` starts both plus Electron

Example `.env` value:

`DATABASE_URL="postgresql://postgres:*****@localhost:****/*****?schema=public"`

## Production Build

Build the packaged Windows app with:

`npm run electron:build`

Before building, create `.env.production` or `.env.production.local` from `.env.production.example`.

Runtime configuration for the packaged app is resolved in this order:

1. `%APPDATA%/pharmapro/.env`
2. `.env` next to `PharmaPro.exe`
3. `resources/.env` bundled with the app

Notes:

1. `npm run electron:build` now packages `build/runtime/.env`, generated from `.env.production.local` or `.env.production`.
2. Production ignores `ALLOW_DEV_AUTH_BYPASS` even if it exists in a source env file.
3. `JWT_SECRET` must be set for production.
4. Re-running `npm run electron:build` is safe; the build now cleans stale Electron and `win-unpacked` locks first.
5. Production no longer auto-creates the default `admin / admin123` account on startup.

## Production Admin Bootstrap

Create or reset the first production admin explicitly with:

`npm run bootstrap:admin -- --email owner@example.com --password "StrongPassword123" --name "Owner" --role OWNER`

Allowed roles for bootstrap are `OWNER` and `ADMIN`.
