import path from "node:path";
import dotenv from "dotenv";
import type { Lang } from "./i18n";

// Loads .env from the working directory (the server root on Pterodactyl).
// Variables already set in the environment (e.g. by the hosting panel) win.
dotenv.config({ quiet: true });

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Config {
  botToken: string;
  supportGroupId: number;
  dbPath: string;
  greetingText: Record<Lang, string>;
  startText: Record<Lang, string>;
  logLevel: LogLevel;
  /** After this long without messages from either side, the next user message starts a new question. */
  sessionIdleMs: number;
  /** Phone number given to users whose question timed out without an answer. */
  supportPhone: string;
}

const DEFAULT_GREETING: Record<Lang, string> = {
  uk: "Дякуємо за звернення! Ваше повідомлення отримано та обробляється. Наша команда невдовзі відповість тут.",
  en:
    "Thanks for reaching out! Your message has been received and is being processed. " +
    "Our team will reply here shortly.",
};

const DEFAULT_START: Record<Lang, string> = {
  uk: "Вітаємо! Напишіть своє питання тут, і наша команда підтримки відповість вам.",
  en: "Hi! Send your question here and our support team will get back to you.",
};

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

/** "\n" in .env values becomes a real line break. */
function text(name: string, fallback: string): string {
  return optional(name, fallback).replace(/\\n/g, "\n");
}

/** NAME_UK / NAME_EN; the legacy un-suffixed NAME still overrides the English text. */
function localized(name: string, defaults: Record<Lang, string>): Record<Lang, string> {
  return {
    uk: text(`${name}_UK`, defaults.uk),
    en: text(`${name}_EN`, text(name, defaults.en)),
  };
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

function parseHours(raw: string): number {
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error(`SESSION_IDLE_HOURS must be a positive number, got "${raw}"`);
  }
  return hours;
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
    greetingText: localized("GREETING_TEXT", DEFAULT_GREETING),
    startText: localized("START_TEXT", DEFAULT_START),
    logLevel: parseLogLevel(optional("LOG_LEVEL", "info")),
    supportPhone: optional("SUPPORT_PHONE", "+380505255167"),
    sessionIdleMs: parseHours(optional("SESSION_IDLE_HOURS", "12")) * 60 * 60 * 1000,
  };
}
