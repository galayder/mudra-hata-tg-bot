import { Keyboard } from "grammy";
import { LANGS, TEXTS, type Lang } from "./i18n";

/** Topics a user picks before asking a question. */
export const CATEGORIES = ["problem", "feature"] as const;
export type Category = (typeof CATEGORIES)[number];

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}

export const CATEGORY_EMOJI: Record<Category, string> = {
  problem: "🐞",
  feature: "💡",
};

/** Shown to users (button labels). */
const LABELS: Record<Lang, Record<Category, string>> = {
  uk: { problem: "🐞 Проблема", feature: "💡 Запропонувати функцію" },
  en: { problem: "🐞 Problem", feature: "💡 Request a feature" },
};

/** Shown to staff in the support group. */
export const STAFF_LABELS: Record<Category, string> = {
  problem: "Problem",
  feature: "Feature request",
};

/** Matches a tapped button in any language (the user may have switched language since). */
export function categoryFromLabel(text: string): Category | undefined {
  for (const lang of LANGS) {
    for (const category of CATEGORIES) {
      if (LABELS[lang][category] === text) return category;
    }
  }
  return undefined;
}

export function allCategoryLabels(): string[] {
  return LANGS.flatMap((lang) => CATEGORIES.map((category) => LABELS[lang][category]));
}

/**
 * Reply keyboard with the topics. It takes the place of the phone keyboard, and the
 * placeholder tells the user to pick a topic first. (The Bot API cannot disable typing,
 * so messages typed anyway are held until a topic is picked.)
 */
export function categoryKeyboard(lang: Lang): Keyboard {
  // One button per row; Keyboard.from builds no trailing empty row.
  return Keyboard.from(CATEGORIES.map((category) => [Keyboard.text(LABELS[lang][category])]))
    .resized()
    .persistent()
    .placeholder(TEXTS[lang].topicPlaceholder);
}
