import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type DB = Database.Database;

const MIGRATIONS: readonly string[] = [
  // v1: one row per Telegram user, mapped to their forum topic in the support group.
  `CREATE TABLE IF NOT EXISTS users (
     user_id     INTEGER PRIMARY KEY,
     thread_id   INTEGER NOT NULL,
     first_name  TEXT    NOT NULL,
     last_name   TEXT,
     username    TEXT,
     created_at  INTEGER NOT NULL,
     updated_at  INTEGER NOT NULL
   );
   CREATE UNIQUE INDEX IF NOT EXISTS idx_users_thread_id ON users(thread_id);`,
  // v2: per-user settings (chosen interface language).
  `CREATE TABLE IF NOT EXISTS user_settings (
     user_id     INTEGER PRIMARY KEY,
     lang        TEXT    NOT NULL,
     updated_at  INTEGER NOT NULL
   );`,
  // v3: support staff who have already been announced to a user ("X joined the chat").
  `CREATE TABLE IF NOT EXISTS chat_participants (
     user_id     INTEGER NOT NULL,
     staff_id    INTEGER NOT NULL,
     joined_at   INTEGER NOT NULL,
     PRIMARY KEY (user_id, staff_id)
   );`,
  // v4: the user's Telegram app language, used when they never picked one in /settings.
  `ALTER TABLE users ADD COLUMN language_code TEXT;`,
  // v5: phone numbers (users are identified by phone) and messages held until one is shared.
  `CREATE TABLE IF NOT EXISTS user_phones (
     user_id     INTEGER PRIMARY KEY,
     phone       TEXT    NOT NULL,
     shared_at   INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS pending_messages (
     user_id     INTEGER NOT NULL,
     message_id  INTEGER NOT NULL,
     created_at  INTEGER NOT NULL,
     PRIMARY KEY (user_id, message_id)
   );`,
  // v6: the user's current question: picked topic, open/closed, last activity.
  `CREATE TABLE IF NOT EXISTS conversations (
     user_id        INTEGER PRIMARY KEY,
     category       TEXT,
     status         TEXT    NOT NULL,
     announced      INTEGER NOT NULL DEFAULT 0,
     last_activity  INTEGER NOT NULL
   );`,
  // v7: who wrote last in the question, to tell "unanswered" from "answered" on timeout.
  `ALTER TABLE conversations ADD COLUMN last_actor TEXT NOT NULL DEFAULT 'user';`,
  // v8: the question's header message in the support group (carries the quick-action buttons).
  `ALTER TABLE conversations ADD COLUMN header_message_id INTEGER;`,
];

export function openDatabase(filePath: string): DB {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  const db = new Database(filePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  migrate(db);
  return db;
}

function migrate(db: DB): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  for (let version = current; version < MIGRATIONS.length; version++) {
    const sql = MIGRATIONS[version];
    if (sql === undefined) break;
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}
