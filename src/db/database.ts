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
