const { app, BrowserWindow, ipcMain } = require('electron');
const { randomBytes } = require('crypto');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawn } = require('child_process');

const resolveRuntimeEnvPath = () => {
  const exeDir = app.isPackaged ? path.dirname(app.getPath('exe')) : null;
  const userDataDir = (() => {
    try {
      return app.getPath('userData');
    } catch {
      return null;
    }
  })();

  const envCandidates = [
    process.env.PHARMAPRO_ENV_FILE,
    userDataDir ? path.join(userDataDir, '.env') : null,
    exeDir ? path.join(exeDir, '.env') : null,
    process.resourcesPath ? path.join(process.resourcesPath, '.env') : null,
    path.join(__dirname, '../.env'),
    path.join(process.cwd(), '.env'),
  ].filter(Boolean);

  for (const envFile of envCandidates) {
    try {
      if (fs.existsSync(envFile)) {
        return envFile;
      }
    } catch {
      // Continue checking other candidates.
    }
  }

  return null;
};

const resolveRuntimeLogPath = () => {
  try {
    const userDataDir = app.getPath('userData');
    return path.join(userDataDir, 'logs', 'electron-runtime.log');
  } catch {
    return path.join(process.cwd(), 'data', 'electron-runtime.log');
  }
};

try {
  const dotenv = require('dotenv');
  const envFile = resolveRuntimeEnvPath();
  if (envFile) {
    dotenv.config({ path: envFile, override: false });
  }
} catch {
  // dotenv not available or .env not found; continue with process env.
}

const isDev = process.env.NODE_ENV === 'development';
const APP_PORT = Number(process.env.PORT || 3921);
const DEV_SERVER_URL = 'http://127.0.0.1:3000';
const desktopAuthSecret = randomBytes(24).toString('hex');
const appStartupStartedAt = Date.now();

let mainWindow = null;
let backendProcess = null;
let backendReady = false;
const runtimeLogPath = resolveRuntimeLogPath();

const stringifyLogPayload = (payload) => {
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
};

const writeRuntimeLog = (tag, payload) => {
  const line = `[${new Date().toISOString()}] [${tag}] ${stringifyLogPayload(payload)}\n`;
  try {
    fs.mkdirSync(path.dirname(runtimeLogPath), { recursive: true });
    fs.appendFileSync(runtimeLogPath, line, 'utf8');
  } catch {
    // Ignore file logging errors and still print to stderr.
  }
  try {
    console.error(line.trim());
  } catch {
    // ignore
  }
};

const singleInstanceLock = app.requestSingleInstanceLock();

if (!singleInstanceLock) {
  writeRuntimeLog('single-instance-lock-failed', { pid: process.pid });
  app.exit(0);
}

process.on('uncaughtException', (error) => {
  writeRuntimeLog('uncaught-exception', {
    message: error?.message,
    stack: error?.stack,
  });
});

process.on('unhandledRejection', (reason) => {
  writeRuntimeLog('unhandled-rejection', {
    reason: stringifyLogPayload(reason),
  });
});

const waitForServer = (url, timeoutMs = 20000) => {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body || '{}');
            if (parsed.ok === true && parsed.service === 'pharmapro-api') {
              resolve(true);
              return;
            }
          } catch {
            // Retry until timeout.
          }

          if (Date.now() - startedAt > timeoutMs) {
            reject(new Error(`Server did not start in time: ${url}`));
            return;
          }
          setTimeout(tick, 350);
        });
      });
      req.on('error', () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Server did not start in time: ${url}`));
          return;
        }
        setTimeout(tick, 350);
      });
    };
    tick();
  });
};

const waitForHttpOk = (url, timeoutMs = 20000) => {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if ((res.statusCode || 500) >= 200 && (res.statusCode || 500) < 400) {
          resolve(true);
          return;
        }

        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`HTTP endpoint did not become ready in time: ${url}`));
          return;
        }
        setTimeout(tick, 200);
      });
      req.on('error', () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`HTTP endpoint did not become ready in time: ${url}`));
          return;
        }
        setTimeout(tick, 200);
      });
    };
    tick();
  });
};

const fetchText = (url) => new Promise((resolve, reject) => {
  const req = http.get(url, (res) => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      body += chunk;
    });
    res.on('end', () => {
      if ((res.statusCode || 500) >= 200 && (res.statusCode || 500) < 400) {
        resolve(body);
        return;
      }
      reject(new Error(`Unexpected status ${res.statusCode} for ${url}`));
    });
  });
  req.on('error', reject);
});

const warmDevRendererAssets = async () => {
  const warmStartedAt = Date.now();
  const viteBaseUrl = new URL(DEV_SERVER_URL);
  const targets = [
    '/',
    '/src/main.tsx',
    '/src/AppRoot.tsx',
    '/src/App.tsx',
    '/src/lib/i18n.ts',
    '/src/presentation/components/LoginView.tsx',
    '/src/index.css',
  ];

  await waitForHttpOk(DEV_SERVER_URL, 15000);

  for (const target of targets) {
    const targetUrl = new URL(target, viteBaseUrl).toString();
    const startedAt = Date.now();
    try {
      await fetchText(targetUrl);
      writeRuntimeLog('dev-warm-hit', {
        target,
        elapsedMs: Date.now() - startedAt,
      });
    } catch (error) {
      writeRuntimeLog('dev-warm-hit-failed', {
        target,
        message: error?.message,
        elapsedMs: Date.now() - startedAt,
      });
    }
  }

  writeRuntimeLog('dev-warm-complete', {
    elapsedMs: Date.now() - warmStartedAt,
  });
};

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const loadDevAppWithRetry = async (window, timeoutMs = 15000) => {
  const startedAt = Date.now();
  let attempt = 0;

  try {
    await warmDevRendererAssets();
  } catch (error) {
    writeRuntimeLog('dev-warm-failed', {
      message: error?.message,
      elapsedMs: Date.now() - startedAt,
    });
  }

  while (window && !window.isDestroyed()) {
    try {
      attempt += 1;
      writeRuntimeLog('dev-load-attempt', {
        attempt,
        url: DEV_SERVER_URL,
        elapsedMs: Date.now() - startedAt,
      });
      await window.loadURL(DEV_SERVER_URL);
      writeRuntimeLog('dev-server-loaded', { url: DEV_SERVER_URL });

      if (process.env.PHARMAPRO_OPEN_DEVTOOLS === '1') {
        window.webContents.openDevTools({ mode: 'detach' });
      }
      return;
    } catch (error) {
      writeRuntimeLog('dev-load-attempt-failed', {
        attempt,
        message: error?.message,
        elapsedMs: Date.now() - startedAt,
      });
      if (Date.now() - startedAt > timeoutMs) {
        throw error;
      }
      await delay(350);
    }
  }
};

const resolveWindowIcon = () => {
  const candidates = [
    path.join(process.cwd(), 'build', 'icon.png'),
    path.join(__dirname, '../build/icon.png'),
    path.join(process.resourcesPath || '', 'build/icon.png'),
  ];

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {
      // Ignore and continue checking the next candidate.
    }
  }
  return undefined;
};

const resolvePreload = () => {
  const candidates = [
    path.join(__dirname, 'preload.cjs'),
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'electron', 'preload.cjs'),
  ];

  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {
      // Ignore and continue checking the next candidate.
    }
  }

  return path.join(__dirname, 'preload.cjs');
};

const startInternalBackend = async () => {
  // dist-server is asarUnpacked, so resolve past app.asar to app.asar.unpacked
  const serverEntry = path.join(__dirname, '../dist-server/server.cjs')
    .replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');

  // Prisma binary is copied alongside server.cjs during the build step
  const findPrismaEngine = (dir) => {
    try {
      const files = fs.readdirSync(dir).filter(f => f.endsWith('.node') && f.includes('query_engine'));
      return files.length > 0 ? path.join(dir, files[0]) : null;
    } catch {
      return null;
    }
  };
  const prismaEngine = findPrismaEngine(path.dirname(serverEntry));

  const runtimeEnvFile = resolveRuntimeEnvPath();

  backendProcess = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      NODE_ENV: 'production',
      PORT: String(APP_PORT),
      ELECTRON_DESKTOP_AUTH_SECRET: desktopAuthSecret,
      ELECTRON_RUN_AS_NODE: '1',
      // Tell the backend where to find the frontend dist/ folder.
      // app.getAppPath() returns the asar path; the spawned Electron Node.js
      // process (ELECTRON_RUN_AS_NODE=1) has asar fs-patching active and can
      // read files from inside the asar archive.
      PHARMAPRO_DIST_PATH: path.join(app.getAppPath(), 'dist'),
      // Tell the backend's env.ts where to find the .env file so dotenv.config()
      // can load DATABASE_URL even in standalone (non-project-root) deployments.
      ...(runtimeEnvFile ? { PHARMAPRO_ENV_FILE: runtimeEnvFile } : {}),
      ...(prismaEngine ? { PRISMA_QUERY_ENGINE_LIBRARY: prismaEngine } : {}),
    },
    windowsHide: true,
    stdio: 'ignore',
  });

  backendProcess.unref();
  await waitForServer(`http://127.0.0.1:${APP_PORT}/api/health`);
  backendReady = true;
};

function createWindow() {
  const windowIcon = resolveWindowIcon();
  const preloadPath = resolvePreload();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 1100,
    minHeight: 720,
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: preloadPath,
      additionalArguments: [`--pharmapro-started-at=${appStartupStartedAt}`],
    },
    icon: windowIcon,
    title: 'PharmaPro Management System',
    backgroundColor: '#f5f5f0',
    show: false,
  });

  writeRuntimeLog('window-created', {
    isDev,
    show: false,
    startupStartedAt: appStartupStartedAt,
  });

  mainWindow.webContents.on('did-start-loading', () => {
    writeRuntimeLog('did-start-loading', {
      url: mainWindow?.webContents?.getURL?.() || null,
    });
  });

  mainWindow.webContents.on('dom-ready', () => {
    writeRuntimeLog('dom-ready', {
      url: mainWindow?.webContents?.getURL?.() || null,
    });
  });

  mainWindow.webContents.on('did-finish-load', () => {
    writeRuntimeLog('did-finish-load', {
      url: mainWindow?.webContents?.getURL?.() || null,
    });
  });

  mainWindow.webContents.on('did-stop-loading', () => {
    writeRuntimeLog('did-stop-loading', {
      url: mainWindow?.webContents?.getURL?.() || null,
    });
  });

  mainWindow.once('ready-to-show', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }

    writeRuntimeLog('window-ready-to-show', {
      isDev,
      url: mainWindow.webContents?.getURL?.() || null,
    });

    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }

    if (!mainWindow.isMaximized()) {
      mainWindow.maximize();
    }

    mainWindow.focus();
  });

  if (isDev) {
    loadDevAppWithRetry(mainWindow)
      .catch((error) => {
        writeRuntimeLog('dev-server-wait-failed', {
          message: error?.message,
        });
      });
  } else if (backendReady) {
    mainWindow.loadURL(`http://127.0.0.1:${APP_PORT}`);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
    writeRuntimeLog('did-fail-load', { code, description, validatedURL, isMainFrame });
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    writeRuntimeLog('render-process-gone', details);
  });

  mainWindow.on('unresponsive', () => {
    writeRuntimeLog('window-unresponsive', { url: mainWindow?.webContents?.getURL?.() });
  });

  mainWindow.on('responsive', () => {
    writeRuntimeLog('window-responsive', { url: mainWindow?.webContents?.getURL?.() });
  });

  // Remove default menu
  mainWindow.setMenu(null);

  // Allow window.open() popups (needed for in-app print preview)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank' || url === '') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1060,
          height: 900,
          autoHideMenuBar: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false,
          },
        },
      };
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    let url = null;
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        url = mainWindow.webContents?.getURL?.() || null;
      }
    } catch {
      url = null;
    }
    writeRuntimeLog('window-closed', { url });
    mainWindow = null;
  });
}

if (singleInstanceLock) {
app.whenReady().then(async () => {
  writeRuntimeLog('app-ready', { isDev, pid: process.pid, appPort: APP_PORT });
  const runtimeUserData = app.getPath('userData');
  const runtimeCache = path.join(runtimeUserData, 'cache');
  fs.mkdirSync(runtimeUserData, { recursive: true });
  fs.mkdirSync(runtimeCache, { recursive: true });

  app.commandLine.appendSwitch('disk-cache-dir', runtimeCache);
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');

  if (!isDev) {
    try {
      await startInternalBackend();
    } catch {
      backendReady = false;
      writeRuntimeLog('backend-start-failed', {
        appPort: APP_PORT,
        envFile: resolveRuntimeEnvPath(),
      });
    }
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      return;
    }

    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
});
}

app.on('second-instance', () => {
  writeRuntimeLog('second-instance', { pid: process.pid });
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.on('window-all-closed', () => {
  writeRuntimeLog('window-all-closed', { platform: process.platform });
  if (backendProcess && !backendProcess.killed) {
    try { backendProcess.kill(); } catch {}
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  writeRuntimeLog('before-quit', { pid: process.pid });
  if (backendProcess && !backendProcess.killed) {
    try { backendProcess.kill(); } catch {}
  }
});

ipcMain.on('window:minimize', () => {
  if (!mainWindow) return;
  mainWindow.minimize();
});

ipcMain.on('window:toggle-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
    return;
  }
  mainWindow.maximize();
});

ipcMain.on('window:close', () => {
  if (!mainWindow) return;
  mainWindow.close();
});

ipcMain.handle('desktop:get-auth-headers', () => {
  return {
    'x-pharmapro-desktop-auth': desktopAuthSecret,
  };
});

ipcMain.on('runtime:mark', (_event, payload) => {
  writeRuntimeLog('runtime-mark', payload || {});
});
