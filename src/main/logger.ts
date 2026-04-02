import fs from 'fs';
import path from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
};

const MAX_LOG_SIZE = 5 * 1024 * 1024; // 5 MB
const MAX_LOG_FILES = 3;

export class Logger {
  private logDir: string;
  private logFile: string;
  private minLevel: LogLevel;
  private stream: fs.WriteStream | null = null;

  constructor(userDataPath: string, minLevel: LogLevel = 'warn') {
    this.logDir = path.join(userDataPath, 'logs');
    this.logFile = path.join(this.logDir, 'anssh.log');
    this.minLevel = minLevel;

    // Ensure log directory exists
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    this.rotateIfNeeded();
    this.openStream();
  }

  private openStream(): void {
    this.stream = fs.createWriteStream(this.logFile, { flags: 'a' });
    this.stream.on('error', (err) => {
      console.error('[Logger] Write stream error:', err.message);
    });
  }

  private rotateIfNeeded(): void {
    try {
      if (!fs.existsSync(this.logFile)) return;
      const stat = fs.statSync(this.logFile);
      if (stat.size < MAX_LOG_SIZE) return;

      // Close current stream
      if (this.stream) {
        this.stream.end();
        this.stream = null;
      }

      // Rotate: anssh.log.2 → delete, anssh.log.1 → .2, anssh.log → .1
      for (let i = MAX_LOG_FILES - 1; i >= 1; i--) {
        const from = i === 1
          ? this.logFile
          : `${this.logFile}.${i - 1}`;
        const to = `${this.logFile}.${i}`;
        if (fs.existsSync(from)) {
          if (fs.existsSync(to)) fs.unlinkSync(to);
          fs.renameSync(from, to);
        }
      }
    } catch (err) {
      console.error('[Logger] Rotation error:', err);
    }
  }

  private formatTimestamp(): string {
    const now = new Date();
    return now.toISOString();
  }

  private write(level: LogLevel, message: string, context?: Record<string, any>): void {
    if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[this.minLevel]) return;

    const entry: any = {
      ts: this.formatTimestamp(),
      level: level.toUpperCase(),
      msg: message,
    };

    if (context) {
      // Flatten error objects
      for (const [k, v] of Object.entries(context)) {
        if (v instanceof Error) {
          entry[k] = { message: v.message, stack: v.stack };
        } else {
          entry[k] = v;
        }
      }
    }

    const line = JSON.stringify(entry) + '\n';

    // Write to file
    if (this.stream && !this.stream.destroyed) {
      this.stream.write(line);
    }

    // Also print error/fatal to stderr for dev convenience
    if (LEVEL_PRIORITY[level] >= LEVEL_PRIORITY['error']) {
      process.stderr.write(`[${entry.level}] ${message}\n`);
    }

    // Check rotation after every write
    this.rotateIfNeeded();
    if (!this.stream || this.stream.destroyed) {
      this.openStream();
    }
  }

  debug(message: string, context?: Record<string, any>): void {
    this.write('debug', message, context);
  }

  info(message: string, context?: Record<string, any>): void {
    this.write('info', message, context);
  }

  warn(message: string, context?: Record<string, any>): void {
    this.write('warn', message, context);
  }

  error(message: string, context?: Record<string, any>): void {
    this.write('error', message, context);
  }

  fatal(message: string, context?: Record<string, any>): void {
    this.write('fatal', message, context);
  }

  /** Flush and close the stream */
  close(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }

  /** Get the path to the log directory */
  getLogDir(): string {
    return this.logDir;
  }

  /** Read recent log entries (last N lines) */
  getRecentLogs(maxLines: number = 100): string[] {
    try {
      if (!fs.existsSync(this.logFile)) return [];
      const content = fs.readFileSync(this.logFile, 'utf-8');
      const lines = content.trim().split('\n');
      return lines.slice(-maxLines);
    } catch {
      return [];
    }
  }
}

// Singleton — initialized from index.ts
let _logger: Logger | null = null;

export function initLogger(userDataPath: string): Logger {
  _logger = new Logger(userDataPath, 'warn');
  return _logger;
}

export function getLogger(): Logger {
  if (!_logger) {
    throw new Error('Logger not initialized — call initLogger() first');
  }
  return _logger;
}
