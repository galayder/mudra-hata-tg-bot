import { InlineKeyboard, type Bot, type Context } from "grammy";
import { categoryKeyboard } from "../categories";
import type { ConversationRepository } from "../db/conversationRepository";
import type { SettingsRepository } from "../db/settingsRepository";
import { detectLang, isLang, LANG_NAMES, LANGS, TEXTS, type Lang } from "../i18n";

export interface MenuDeps {
  settings: SettingsRepository;
  conversations: ConversationRepository;
  startText: Record<Lang, string>;
}

/**
 * Where a language picker was shown, so the message can be updated to fit after a choice:
 * - "start": the first-visit welcome → becomes the welcome text in the chosen language
 * - "settings": the /settings picker → becomes a "language changed" confirmation
 */
type PickerSource = "start" | "settings";
const LANG_CALLBACK = /^lang:(\w+):(start|settings)$/;

/** /start and /settings in private chats. Telegram's "Menu" button lists them (see setBotCommands). */
export function registerMenuHandlers(bot: Bot, deps: MenuDeps): void {
  const privateChat = bot.chatType("private");

  privateChat.command("start", async (ctx) => {
    const saved = deps.settings.getLang(ctx.from.id);
    if (saved) {
      await ctx.reply(deps.startText[saved], { reply_markup: topicsOrNothing(deps, ctx.from.id, saved) });
      return;
    }
    // First visit: no language chosen yet. Greet in the Telegram app's language and ask.
    const lang = detectLang(ctx.from.language_code);
    await ctx.reply(`${deps.startText[lang]}\n\n🌐 ${TEXTS.uk.choosePrompt} / ${TEXTS.en.choosePrompt}`, {
      reply_markup: langKeyboard("start"),
    });
  });

  privateChat.command("settings", async (ctx) => {
    const lang = langOf(deps.settings, ctx);
    await ctx.reply(TEXTS[lang].settingsPrompt, { reply_markup: langKeyboard("settings", lang) });
  });

  bot.callbackQuery(LANG_CALLBACK, async (ctx) => {
    const [, lang, source] = ctx.match;
    await ctx.answerCallbackQuery();
    if (!isLang(lang)) return;

    deps.settings.setLang(ctx.from.id, lang);
    const text = (source as PickerSource) === "start" ? deps.startText[lang] : TEXTS[lang].langChanged;
    // Replacing the text without reply_markup also removes the buttons.
    const edited = await ctx.editMessageText(text).then(
      () => true,
      () => false, // e.g. "message is not modified" on a double tap: harmless.
    );
    // First visit: right after the welcome, offer the topics. An inline-keyboard message
    // cannot be edited into a reply keyboard, so this is a new message.
    if (edited && source === "start") {
      await ctx.reply(TEXTS[lang].chooseTopic, { reply_markup: topicsOrNothing(deps, ctx.from.id, lang) });
    }
  });
}

/** The topic keyboard, unless the user is in the middle of a question (then clear any keyboard). */
function topicsOrNothing(deps: MenuDeps, userId: number, lang: Lang) {
  return deps.conversations.active(userId) ? { remove_keyboard: true as const } : categoryKeyboard(lang);
}

function langOf(settings: SettingsRepository, ctx: Context): Lang {
  return settings.getLang(ctx.from!.id) ?? detectLang(ctx.from!.language_code);
}

function langKeyboard(source: PickerSource, current?: Lang): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const lang of LANGS) {
    kb.text(`${lang === current ? "✅ " : ""}${LANG_NAMES[lang]}`, `lang:${lang}:${source}`);
  }
  return kb;
}

/** Registers the commands behind Telegram's "Menu" button, localized per client language. */
export async function setBotCommands(bot: Bot, supportGroupId: number): Promise<void> {
  const commands = (lang: Lang) => [
    { command: "start", description: TEXTS[lang].cmdStart },
    { command: "settings", description: TEXTS[lang].cmdSettings },
  ];
  const privateScope = { scope: { type: "all_private_chats" as const } };
  await bot.api.setMyCommands(commands("en"), privateScope);
  await bot.api.setMyCommands(commands("uk"), { ...privateScope, language_code: "uk" });
  // Staff side: /close in the support group.
  await bot.api.setMyCommands([{ command: "close", description: "Close this user's question" }], {
    scope: { type: "chat", chat_id: supportGroupId },
  });
}
