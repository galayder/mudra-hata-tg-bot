import { Keyboard, type Bot, type Context } from "grammy";
import type { ContactRepository } from "../db/contactRepository";
import type { SettingsRepository } from "../db/settingsRepository";
import type { UserProfile } from "../db/userRepository";
import { detectLang, TEXTS, type Lang } from "../i18n";
import { logger } from "../logger";
import { isMissingTopicError, type TopicManager } from "../services/topicManager";

export interface UserHandlerDeps {
  topics: TopicManager;
  supportGroupId: number;
  settings: SettingsRepository;
  contacts: ContactRepository;
  greetingText: Record<Lang, string>;
}

/**
 * Private chat → user's topic in the support group.
 * Register after the menu handlers so /start and /settings are not forwarded.
 *
 * Users are identified by phone number. Until a user shares theirs, their messages are
 * held back and they are asked for it. Once shared, the phone number and every held
 * message are sent to their topic, in order.
 */
export function registerUserHandlers(bot: Bot, deps: UserHandlerDeps): void {
  const privateChat = bot.chatType("private");
  const langOf = (ctx: Context): Lang =>
    deps.settings.getLang(ctx.from!.id) ?? detectLang(ctx.from!.language_code);

  privateChat.on("message:contact", async (ctx, next) => {
    const contact = ctx.msg.contact;
    // The "share phone" button always sends the user's own contact. Anything else
    // (a contact card from the attachment menu) is treated as a normal message, but
    // only after the user is identified.
    if (contact.user_id !== ctx.from.id) {
      if (deps.contacts.getPhone(ctx.from.id) !== undefined) return next();
      const lang = langOf(ctx);
      await ctx.reply(TEXTS[lang].notOwnContact, { reply_markup: phoneKeyboard(lang) });
      return;
    }

    const phone = normalizePhone(contact.phone_number);
    deps.contacts.setPhone(ctx.from.id, phone);
    logger.info(`User ${ctx.from.id} shared their phone number`);

    const profile = profileOf(ctx);
    const held = deps.contacts.pending(ctx.from.id);
    const { isFirstContact } = await sendToTopic(deps, profile, async (threadId) => {
      await ctx.api.sendMessage(deps.supportGroupId, `📱 Phone: ${phone}`, { message_thread_id: threadId });
      // copyMessages: 1–100 IDs per call, strictly increasing (held is sorted); keeps albums
      // grouped and skips messages the user has since deleted.
      for (let i = 0; i < held.length; i += 100) {
        await ctx.api.copyMessages(deps.supportGroupId, ctx.chat.id, held.slice(i, i + 100), {
          message_thread_id: threadId,
        });
      }
    });
    deps.contacts.clearPending(ctx.from.id);

    const lang = langOf(ctx);
    const text = isFirstContact || held.length > 0 ? deps.greetingText[lang] : TEXTS[lang].phoneSaved;
    await ctx.reply(text, { reply_markup: { remove_keyboard: true } });
  });

  privateChat.on("message", async (ctx) => {
    if (deps.contacts.getPhone(ctx.from.id) === undefined) {
      const firstHeld = deps.contacts.hold(ctx.from.id, ctx.msg.message_id);
      if (firstHeld) {
        const lang = langOf(ctx);
        await ctx.reply(TEXTS[lang].askPhone, { reply_markup: phoneKeyboard(lang) });
      }
      return;
    }

    const { isFirstContact } = await sendToTopic(deps, profileOf(ctx), async (threadId) => {
      await ctx.copyMessage(deps.supportGroupId, { message_thread_id: threadId });
    });
    if (isFirstContact) {
      await ctx.reply(deps.greetingText[langOf(ctx)]);
    }
  });
}

/** Finds (or creates) the user's topic and runs `send`, recreating the topic once if it was deleted. */
async function sendToTopic(
  deps: UserHandlerDeps,
  profile: UserProfile,
  send: (threadId: number) => Promise<void>,
): Promise<{ isFirstContact: boolean }> {
  const { threadId, isFirstContact } = await deps.topics.resolve(profile);
  try {
    await send(threadId);
  } catch (err) {
    if (!isMissingTopicError(err)) throw err;
    logger.warn(`Topic ${threadId} for user ${profile.userId} is gone, recreating`);
    const recreated = await deps.topics.recreate(profile);
    await send(recreated.threadId);
  }
  return { isFirstContact };
}

function profileOf(ctx: Context): UserProfile {
  const from = ctx.from!;
  return {
    userId: from.id,
    firstName: from.first_name,
    lastName: from.last_name,
    username: from.username,
    languageCode: from.language_code,
  };
}

/** Telegram sometimes omits the leading "+". */
function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("+") ? trimmed : `+${trimmed}`;
}

function phoneKeyboard(lang: Lang): Keyboard {
  return new Keyboard().requestContact(TEXTS[lang].sharePhoneButton).resized().persistent();
}
