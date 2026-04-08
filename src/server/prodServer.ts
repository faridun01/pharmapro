import './env'; // MUST be first — loads dotenv before any module initializes PrismaClient
import path from 'path';
import express from 'express';
import { createApp } from './app/createApp';
import { ensureAdminUser } from './common/auth';
import { ensureProductPackagingBackfill } from './services/packaging.service';

const app = createApp();
const PORT = Number(process.env.PORT || 3921);

// In the packaged Electron app, the backend runs from app.asar.unpacked/dist-server/.
// The frontend dist/ is inside app.asar — the Electron main process passes the correct
// asar-based path via PHARMAPRO_DIST_PATH so the spawned Node.js process (which has
// Electron's asar fs patching active via ELECTRON_RUN_AS_NODE=1) can serve it.
const distPath = process.env.PHARMAPRO_DIST_PATH ?? path.join(__dirname, '../dist');

app.use(express.static(distPath));
app.get('*', (_req, res) => {
  if (_req.path.startsWith('/api/')) {
    return res.status(404).json({
      error: 'API route not found',
      code: 'API_NOT_FOUND',
    });
  }
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, '127.0.0.1', async () => {
  console.log(`Prod server running on http://127.0.0.1:${PORT}`);
  try {
    await ensureAdminUser();
  } catch (err) {
    console.error('[startup] ensureAdminUser failed:', err instanceof Error ? err.message : err);
  }
  try {
    const packagingBackfill = await ensureProductPackagingBackfill();
    if (packagingBackfill.updated > 0) {
      console.log(`Backfilled unitsPerPack for ${packagingBackfill.updated} products`);
    }
  } catch (err) {
    console.error('[startup] packagingBackfill failed:', err instanceof Error ? err.message : err);
  }
});
