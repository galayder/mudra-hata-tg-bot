import { Keyboard, type Bot, type Context } from "grammy";
import { categoryFromLabel, categoryKeyboard, allCategoryLabels, STAFF_LABELS, CATEGORY_EMOJI } from "../categories";
import type { ContactRepository } from "../db/contactRepository";
import type { ConversationRepository } from "../db/conversationRepository";
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
  conversations: ConversationRepository;
  greetingText: Record<Lang, string>;
}

/**
 * Private chat → user's topic in the support group.
 * Register after the menu handlers so /start and /settings are not forwarded.
 *
 * Every user message is held first, then delivered once two things are in place:
 *   1. an active question with a topic (Problem / Request a feature). A new question
 *      starts after staff /close it, or after SESSION_IDLE_HOURS of silence;
 *   2. the user's phone number (users are identified by phone; asked once, ever).
 * Missing either, the user is asked for it and messages wait, in order.
 */
export function registerUserHandlers(bot: Bot, deps: UserHandlerDeps): void {
  const privateChat = bot.chatType("private");
  const langOf = (ctx: Context): Lang =>
    deps.settings.getLang(ctx.from!.id) ?? detectLang(ctx.from!.language_code);

  // User picked a topic: this starts a new question.
  privateChat.hears(allCategoryLabels(), async (ctx) => {
    const category = categoryFromLabel(ctx.msg.text ?? "");
    if (category === undefined) return;
    const userId = ctx.from.id;
    const lang = langOf(ctx);
    deps.conversations.start(userId, category);

    if (deps.contacts.pending(userId).length === 0) {
      await ctx.reply(TEXTS[lang].describe, { reply_markup: { remove_keyboard: true } });
    } else if (deps.contacts.getPhone(userId) === undefined) {
      await ctx.reply(TEXTS[lang].askPhone, { reply_markup: phoneKeyboard(lang) });
    } else {
      await deliver(ctx, deps, lang);
    }
  });

  privateChat.on("message:contact", async (ctx, next) => {
    const contact = ctx.msg.contact;
    // The "share phone" button always sends the user's own contact. Another person's
    // contact card is an ordinary message once the user is identified; before that, ask again.
    if (contact.user_id !== ctx.from.id) {
      if (deps.contacts.getPhone(ctx.from.id) !== undefined) return next();
      const lang = langOf(ctx);
      await ctx.reply(TEXTS[lang].notOwnContact, { reply_markup: phoneKeyboard(lang) });
      return;
    }

    deps.contacts.setPhone(ctx.from.id, normalizePhone(contact.phone_number));
    logger.info(`User ${ctx.from.id} shared their phone number`);

    const lang = langOf(ctx);
    if (deps.conversations.active(ctx.from.id) === undefined) {
      await ctx.reply(TEXTS[lang].phoneSaved, { reply_markup: categoryKeyboard(lang) });
      return;
    }
    const delivered = await deliver(ctx, deps, lang);
    if (!delivered) await ctx.reply(TEXTS[lang].phoneSaved, { reply_markup: { remove_keyboard: true } });
  });

  privateChat.on("message", async (ctx) => {
    const userId = ctx.from.id;
    const lang = langOf(ctx);
    const firstHeld = deps.contacts.hold(userId, ctx.msg.message_id);

    if (deps.conversations.active(userId) === undefined) {
      // Closed, idle or never started: begin a new question and ask for its topic.
      if (!deps.conversations.awaitingCategory(userId)) deps.conversations.start(userId, null);
      if (firstHeld) await ctx.reply(TEXTS[lang].chooseTopic, { reply_markup: categoryKeyboard(lang) });
      return;
    }
    if (deps.contacts.getPhone(userId) === undefined) {
      if (firstHeld) await ctx.reply(TEXTS[lang].askPhone, { reply_markup: phoneKeyboard(lang) });
      return;
    }
    await deliver(ctx, deps, lang);
  });
}

/**
 * Sends held messages to the user's topic, preceded by a header when this is a new question.
 * Returns false (and sends nothing) unless there is an active question, a phone and something to send.
 */
async function deliver(ctx: Context, deps: UserHandlerDeps, lang: Lang): Promise<boolean> {
  const userId = ctx.from!.id;
  const conversation = deps.conversations.active(userId);
  const phone = deps.contacts.getPhone(userId);
  const held = deps.contacts.pending(userId);
  if (!conversation?.category || phone === undefined || held.length === 0) return false;

  const category = conversation.category;
  const newQuestion = !conversation.announced;
  const profile = { ...profileOf(ctx), phone };

  await sendToTopic(deps, profile, async (threadId) => {
    if (newQuestion) {
      const header = [`🆕 New question`, `🏷 Topic: ${STAFF_LABELS[category]}`, `📱 Phone: ${phone}`].join("\n");
      await ctx.api.sendMessage(deps.supportGroupId, header, { message_thread_id: threadId });
      await deps.topics.setStatus(profile, threadId, `🟢${CATEGORY_EMOJI[category]}`);
    }
    // copyMessages: 1–100 IDs per call in strictly increasing order (held is sorted);
    // albums stay grouped, messages the user deleted meanwhile are skipped.
    for (let i = 0; i < held.length; i += 100) {
      await ctx.api.copyMessages(deps.supportGroupId, userId, held.slice(i, i + 100), {
        message_thread_id: threadId,
      });
    }
  });

  deps.contacts.clearPending(userId);
  deps.conversations.touch(userId, "user");
  if (newQuestion) {
    deps.conversations.markAnnounced(userId);
    await ctx.reply(deps.greetingText[lang], { reply_markup: { remove_keyboard: true } });
  }
  return true;
}

/** Finds (or creates) the user's topic and runs `send`, recreating the topic once if it was deleted. */
async function sendToTopic(
  deps: UserHandlerDeps,
  profile: UserProfile,
  send: (threadId: number) => Promise<void>,
): Promise<void> {
  const { threadId } = await deps.topics.resolve(profile);
  try {
    await send(threadId);
  } catch (err) {
    if (!isMissingTopicError(err)) throw err;
    logger.warn(`Topic ${threadId} for user ${profile.userId} is gone, recreating`);
    const recreated = await deps.topics.recreate(profile);
    await send(recreated.threadId);
  }
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
