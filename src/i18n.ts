export const LANGS = ["uk", "en"] as const;
export type Lang = (typeof LANGS)[number];

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANGS as readonly string[]).includes(value);
}

/** Picks a language from Telegram's `language_code`: Ukrainian for `uk`, English otherwise. */
export function detectLang(languageCode: string | undefined): Lang {
  return languageCode?.toLowerCase().startsWith("uk") ? "uk" : "en";
}

/** User-facing texts. Greeting and /start texts come from config so they can be overridden in .env. */
export const TEXTS = {
  uk: {
    choosePrompt: "Оберіть мову",
    settingsPrompt: "Оберіть мову:",
    langChanged: "Мову змінено на українську 🇺🇦",
    cmdStart: "Почати",
    cmdSettings: "Налаштування",
  },
  en: {
    choosePrompt: "Choose your language",
    settingsPrompt: "Choose your language:",
    langChanged: "Language set to English 🇬🇧",
    cmdStart: "Start",
    cmdSettings: "Settings",
  },
} as const satisfies Record<Lang, Record<string, string>>;

export const LANG_NAMES: Record<Lang, string> = {
  uk: "🇺🇦 Українська",
  en: "🇬🇧 English",
};
