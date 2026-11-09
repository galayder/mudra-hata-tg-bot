import path from "node:path";
import dotenv from "dotenv";

// Loads .env from the working directory (the server root on Pterodactyl).
// Variables already set in the environment (e.g. by the hosting panel) win.
dotenv.config({ quiet: true });

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Config {
  botToken: string;
  supportGroupId: number;
  dbPath: string;
  greetingText: string;
  startText: string;
  logLevel: LogLevel;
}

const DEFAULT_GREETING =
  "Thanks for reaching out! Your message has been received and is being processed. " +
  "Our team will reply here shortly.";

const DEFAULT_START =
  "Hi! Send your question here and our support team will get back to you.";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name]?.trim();
  return value ? value : fallback;
}

function parseGroupId(raw: string): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id >= 0) {
    throw new Error(
      `SUPPORT_GROUP_ID must be a negative integer (supergroups look like -100...), got "${raw}"`,
    );
  }
  return id;
}

function parseLogLevel(raw: string): LogLevel {
  const levels: readonly LogLevel[] = ["debug", "info", "warn", "error"];
  const level = raw.toLowerCase() as LogLevel;
  return levels.includes(level) ? level : "info";
}

export function loadConfig(): Config {
  return {
    botToken: required("BOT_TOKEN"),
    supportGroupId: parseGroupId(required("SUPPORT_GROUP_ID")),
    dbPath: path.resolve(optional("DB_PATH", "./data/bot.sqlite")),
    // "\n" in .env values becomes a real line break.
    greetingText: optional("GREETING_TEXT", DEFAULT_GREETING).replace(/\\n/g, "\n"),
    startText: optional("START_TEXT", DEFAULT_START).replace(/\\n/g, "\n"),
    logLevel: parseLogLevel(optional("LOG_LEVEL", "info")),
  };
}
