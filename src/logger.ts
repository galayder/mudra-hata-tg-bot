import type { LogLevel } from "./config";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold: number = ORDER.info;

export function setLogLevel(level: LogLevel): void {
  threshold = ORDER[level];
}

function write(level: LogLevel, message: string, extra?: unknown): void {
  if (ORDER[level] < threshold) return;
  const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${message}`;
  const out = level === "error" || level === "warn" ? console.error : console.log;
  if (extra === undefined) out(line);
  else out(line, extra);
}

export const logger = {
  debug: (msg: string, extra?: unknown) => write("debug", msg, extra),
  info: (msg: string, extra?: unknown) => write("info", msg, extra),
  warn: (msg: string, extra?: unknown) => write("warn", msg, extra),
  error: (msg: string, extra?: unknown) => write("error", msg, extra),
};
