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
    cmdWebsite: "Наш сайт",
    websiteText: "🌐 Наш сайт:",
    websiteButton: "Відкрити mudrahata.com",
    staffJoined: "👤 {name} приєднується до чату",
    askPhone: "Щоб ми могли вам допомогти, поділіться, будь ласка, своїм номером телефону — натисніть кнопку нижче 👇",
    sharePhoneButton: "📱 Поділитися номером",
    notOwnContact: "Будь ласка, поділіться власним номером за допомогою кнопки нижче 👇",
    phoneSaved: "Дякуємо! Номер збережено.",
    chooseTopic: "Оберіть, будь ласка, тему звернення 👇",
    topicPlaceholder: "Оберіть тему нижче",
    describe: "Опишіть, будь ласка, ваше питання одним або кількома повідомленнями.",
    timeoutApology:
      "😔 Вибачте, нам не вдалося вчасно відповісти на ваше звернення. Ви можете поставити питання ще раз — оберіть тему нижче — або зателефонувати нам: {phone}",
    closed: "✅ Ваше звернення закрито. Якщо потрібна ще допомога — оберіть тему та напишіть нам.",
  },
  en: {
    choosePrompt: "Choose your language",
    settingsPrompt: "Choose your language:",
    langChanged: "Language set to English 🇬🇧",
    cmdStart: "Start",
    cmdSettings: "Settings",
    cmdWebsite: "Our website",
    websiteText: "🌐 Our website:",
    websiteButton: "Open mudrahata.com",
    staffJoined: "👤 {name} joined the chat",
    askPhone: "To help you, we need your phone number. Please tap the button below to share it 👇",
    sharePhoneButton: "📱 Share phone number",
    notOwnContact: "Please share your own number using the button below 👇",
    phoneSaved: "Thanks! Your number has been saved.",
    chooseTopic: "Please choose the topic of your request 👇",
    topicPlaceholder: "Choose a topic below",
    describe: "Please describe your question in one or more messages.",
    timeoutApology:
      "😔 We're sorry we were unable to respond to your request. You can ask your question again — choose a topic below — or call us: {phone}",
    closed: "✅ Your request has been closed. If you need more help, choose a topic and write to us.",
  },
} as const satisfies Record<Lang, Record<string, string>>;

export const LANG_NAMES: Record<Lang, string> = {
  uk: "🇺🇦 Українська",
  en: "🇬🇧 English",
};
