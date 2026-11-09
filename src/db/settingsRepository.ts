import { isLang, type Lang } from "../i18n";
import type { DB } from "./database";

/** Per-user preferences, independent of whether the user has a support topic yet. */
export class SettingsRepository {
  private readonly getLangStmt;
  private readonly setLangStmt;

  constructor(db: DB) {
    this.getLangStmt = db.prepare<[number], { lang: string }>("SELECT lang FROM user_settings WHERE user_id = ?");
    this.setLangStmt = db.prepare<[number, string, number]>(
      `INSERT INTO user_settings (user_id, lang, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET lang = excluded.lang, updated_at = excluded.updated_at`,
    );
  }

  getLang(userId: number): Lang | undefined {
    const lang = this.getLangStmt.get(userId)?.lang;
    return isLang(lang) ? lang : undefined;
  }

  setLang(userId: number, lang: Lang): void {
    this.setLangStmt.run(userId, lang, Date.now());
  }
}
