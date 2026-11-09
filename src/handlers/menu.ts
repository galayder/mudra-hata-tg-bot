import { InlineKeyboard, Keyboard, type Bot, type Context } from "grammy";
import type { SettingsRepository } from "../db/settingsRepository";
import { allLabels, detectLang, isLang, LANG_NAMES, LANGS, TEXTS, type Lang } from "../i18n";

export interface MenuDeps {
  settings: SettingsRepository;
  startText: Record<Lang, string>;
}

const LANG_CALLBACK = /^lang:(.+)$/;

/** /start, /settings and the persistent reply-keyboard menu in private chats. */
export function registerMenuHandlers(bot: Bot, deps: MenuDeps): void {
  const privateChat = bot.chatType("private");

  const langOf = (ctx: Context): Lang =>
    deps.settings.getLang(ctx.from!.id) ?? detectLang(ctx.from!.language_code);

  const sendStart = async (ctx: Context): Promise<void> => {
    const lang = langOf(ctx);
    await ctx.reply(deps.startText[lang], { reply_markup: menuKeyboard(lang) });
  };

  const sendSettings = async (ctx: Context): Promise<void> => {
    const lang = langOf(ctx);
    await ctx.reply(TEXTS[lang].settingsPrompt, { reply_markup: langKeyboard(lang) });
  };

  privateChat.command("start", sendStart);
  privateChat.command("settings", sendSettings);
  privateChat.hears(allLabels("menuStart"), sendStart);
  privateChat.hears(allLabels("menuSettings"), sendSettings);

  bot.callbackQuery(LANG_CALLBACK, async (ctx) => {
    const lang = ctx.match[1];
    if (!isLang(lang)) {
      await ctx.answerCallbackQuery();
      return;
    }
    deps.settings.setLang(ctx.from.id, lang);
    await ctx.answerCallbackQuery();
    // Refresh the inline picker so the checkmark moves, then send a message carrying
    // the menu in the new language (a reply keyboard can only be replaced by a new message).
    await ctx.editMessageText(TEXTS[lang].settingsPrompt, { reply_markup: langKeyboard(lang) }).catch(() => {
      // "message is not modified" when the same language is tapped twice: harmless.
    });
    await ctx.reply(TEXTS[lang].langChanged, { reply_markup: menuKeyboard(lang) });
  });
}

function menuKeyboard(lang: Lang): Keyboard {
  return new Keyboard()
    .text(TEXTS[lang].menuStart)
    .text(TEXTS[lang].menuSettings)
    .resized()
    .persistent();
}

function langKeyboard(current: Lang): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const lang of LANGS) {
    kb.text(`${lang === current ? "✅ " : ""}${LANG_NAMES[lang]}`, `lang:${lang}`);
  }
  return kb;
}

/** Registers the "/" command list shown by Telegram, localized per client language. */
export async function setBotCommands(bot: Bot): Promise<void> {
  const commands = (lang: Lang) => [
    { command: "start", description: TEXTS[lang].cmdStart },
    { command: "settings", description: TEXTS[lang].cmdSettings },
  ];
  const privateScope = { scope: { type: "all_private_chats" as const } };
  await bot.api.setMyCommands(commands("en"), privateScope);
  await bot.api.setMyCommands(commands("uk"), { ...privateScope, language_code: "uk" });
}
