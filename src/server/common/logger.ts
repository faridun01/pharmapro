import fs from 'fs';
import path from 'path';
import { config } from '../config';

/**
 * Resolve the log directory for the desktop application.
 * Priority: PHARMAPRO_USER_DATA env > APPDATA/pharmapro > process.cwd()/logs
 */
const resolveLogDir = () => {
  if (process.env.PHARMAPRO_USER_DATA) return path.join(process.env.PHARMAPRO_USER_DATA, 'logs');
  
  const appData = process.env.APPDATA || (process.platform === 'darwin' ? path.join(process.env.HOME || '', 'Library/Application Support') : path.join(process.env.HOME || '', '.config'));
  const fallback = path.join(appData, 'pharmapro', 'logs');
  
  if (process.env.NODE_ENV === 'production') return fallback;
  return path.join(process.cwd(), 'logs');
};

const logDir = resolveLogDir();
const logFile = path.join(logDir, 'backend.log');

// Ensure directory exists
try {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
} catch (err) {
  console.error('Failed to create log directory:', err);
}

const writeToFile = (message: string) => {
  try {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logFile, `[${timestamp}] ${message}\n`, 'utf8');
  } catch (err) {
    // Silent fail for file logging to prevent recursive errors
  }
};

export const logger = {
  info: (message: string, context?: any) => {
    const msg = `[INFO] ${message} ${context ? JSON.stringify(context) : ''}`;
    console.log(msg);
    writeToFile(msg);
  },
  warn: (message: string, context?: any) => {
    const msg = `[WARN] ${message} ${context ? JSON.stringify(context) : ''}`;
    console.warn(msg);
    writeToFile(msg);
  },
  error: (message: string, err?: any) => {
    const errorMsg = err instanceof Error ? `${err.message} ${err.stack}` : JSON.stringify(err);
    const msg = `[ERROR] ${message} ${errorMsg}`;
    console.error(msg);
    writeToFile(msg);
  },
  debug: (message: string, context?: any) => {
    if (config.NODE_ENV === 'development' || config.LOG_LEVEL === 'debug') {
      const msg = `[DEBUG] ${message} ${context ? JSON.stringify(context) : ''}`;
      console.debug(msg);
      writeToFile(msg);
    }
  }
};
