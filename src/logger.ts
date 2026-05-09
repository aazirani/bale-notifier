type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "info";

export function setLogLevel(level: string | undefined): void {
  if (level && level in LEVEL_PRIORITY) {
    currentLevel = level as LogLevel;
  }
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
}

function formatMessage(level: LogLevel, ...args: unknown[]): unknown[] {
  const timestamp = new Date().toISOString();
  return [`[${level}] ${timestamp}`, ...args];
}

export const logger = {
  debug(...args: unknown[]): void {
    if (shouldLog("debug")) console.log(...formatMessage("debug", ...args));
  },

  info(...args: unknown[]): void {
    if (shouldLog("info")) console.log(...formatMessage("info", ...args));
  },

  warn(...args: unknown[]): void {
    if (shouldLog("warn")) console.warn(...formatMessage("warn", ...args));
  },

  error(...args: unknown[]): void {
    if (shouldLog("error")) console.error(...formatMessage("error", ...args));
  },
};
