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
    staffJoined: "👤 {name} приєднується до чату",
    askPhone: "Щоб ми могли вам допомогти, поділіться, будь ласка, своїм номером телефону — натисніть кнопку нижче 👇",
    sharePhoneButton: "📱 Поділитися номером",
    notOwnContact: "Будь ласка, поділіться власним номером за допомогою кнопки нижче 👇",
    phoneSaved: "Дякуємо! Номер збережено.",
  },
  en: {
    choosePrompt: "Choose your language",
    settingsPrompt: "Choose your language:",
    langChanged: "Language set to English 🇬🇧",
    cmdStart: "Start",
    cmdSettings: "Settings",
    staffJoined: "👤 {name} joined the chat",
    askPhone: "To help you, we need your phone number. Please tap the button below to share it 👇",
    sharePhoneButton: "📱 Share phone number",
    notOwnContact: "Please share your own number using the button below 👇",
    phoneSaved: "Thanks! Your number has been saved.",
  },
} as const satisfies Record<Lang, Record<string, string>>;

export const LANG_NAMES: Record<Lang, string> = {
  uk: "🇺🇦 Українська",
  en: "🇬🇧 English",
};
