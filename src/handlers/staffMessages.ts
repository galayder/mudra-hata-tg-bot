import { GrammyError, type Bot, type Context, type FilterQuery } from "grammy";
import { categoryKeyboard } from "../categories";
import type { ConversationRepository } from "../db/conversationRepository";
import type { ParticipantRepository } from "../db/participantRepository";
import type { SettingsRepository } from "../db/settingsRepository";
import { detectLang, TEXTS } from "../i18n";
import { logger } from "../logger";
import { profileFromRecord, type TopicManager } from "../services/topicManager";

export interface StaffHandlerDeps {
  topics: TopicManager;
  supportGroupId: number;
  settings: SettingsRepository;
  participants: ParticipantRepository;
  conversations: ConversationRepository;
}

/** Content types that can be copied back to the user. Service messages are skipped. */
const COPYABLE: FilterQuery[] = [
  "message:text",
  "message:photo",
  "message:video",
  "message:animation",
  "message:audio",
  "message:document",
  "message:voice",
  "message:video_note",
  "message:sticker",
  "message:location",
  "message:venue",
  "message:contact",
  "message:poll",
  "message:dice",
];

/** Staff replies inside a user's topic → that user's private chat. */
export function registerStaffHandlers(bot: Bot, deps: StaffHandlerDeps): void {
  const group = bot.filter((ctx) => ctx.chat?.id === deps.supportGroupId);

  // /close inside a user's topic: the question is resolved; the user's next message starts a new one.
  group.command("close", async (ctx) => {
    const threadId = ctx.msg.is_topic_message ? ctx.msg.message_thread_id : undefined;
    const user = threadId === undefined ? undefined : deps.topics.findUserByThread(threadId);
    if (threadId === undefined || user === undefined) {
      await ctx.reply("Use /close inside a user's topic.", replyTo(ctx));
      return;
    }
    if (!deps.conversations.close(user.userId)) {
      await ctx.reply("There is no open question to close.", replyTo(ctx));
      return;
    }
    await deps.topics.setStatus(profileFromRecord(user), threadId, "✅");
    const lang = deps.settings.getLang(user.userId) ?? detectLang(user.languageCode ?? undefined);
    try {
      await ctx.api.sendMessage(user.userId, TEXTS[lang].closed, { reply_markup: categoryKeyboard(lang) });
      await ctx.reply("✅ Closed. The user's next message will start a new question.", replyTo(ctx));
    } catch (err) {
      await reportDeliveryFailure(ctx, err);
    }
  });

  group.on(COPYABLE, async (ctx) => {
    const msg = ctx.msg;
    if (!msg) return;

    // Ignore the "General" topic, other bots, and commands / internal notes.
    if (!msg.is_topic_message || msg.message_thread_id === undefined) return;
    if (ctx.from?.is_bot) return;
    if ((msg.text ?? "").startsWith("/")) return;

    const user = deps.topics.findUserByThread(msg.message_thread_id);
    if (user === undefined) {
      logger.debug(`No user mapped to topic ${msg.message_thread_id}, ignoring`);
      return;
    }

    const userId = user.userId;
    const staff = ctx.from!;
    try {
      // First reply from this staff member to this user: introduce them.
      if (!deps.participants.hasJoined(userId, staff.id)) {
        const lang = deps.settings.getLang(userId) ?? detectLang(user.languageCode ?? undefined);
        await ctx.api.sendMessage(userId, TEXTS[lang].staffJoined.replace("{name}", staff.first_name));
        deps.participants.markJoined(userId, staff.id);
      }
      await ctx.copyMessage(userId);
      deps.conversations.touch(userId, "staff");
    } catch (err) {
      await reportDeliveryFailure(ctx, err);
    }
  });
}

function replyTo(ctx: Context) {
  return { reply_parameters: { message_id: ctx.msg!.message_id, allow_sending_without_reply: true } };
}

async function reportDeliveryFailure(ctx: Context, err: unknown): Promise<void> {
  const reason =
    err instanceof GrammyError && err.error_code === 403
      ? "the user blocked the bot or deleted their account"
      : err instanceof GrammyError
        ? err.description
        : "unexpected error";
  logger.warn(`Failed to deliver staff reply: ${reason}`, err instanceof GrammyError ? undefined : err);
  await ctx.reply(`⚠️ Not delivered: ${reason}.`, {
    reply_parameters: { message_id: ctx.msg!.message_id, allow_sending_without_reply: true },
  });
}
