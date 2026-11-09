import { GrammyError, type Bot, type Context, type FilterQuery } from "grammy";
import { logger } from "../logger";
import type { TopicManager } from "../services/topicManager";

export interface StaffHandlerDeps {
  topics: TopicManager;
  supportGroupId: number;
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
  bot
    .filter((ctx) => ctx.chat?.id === deps.supportGroupId)
    .on(COPYABLE, async (ctx) => {
      const msg = ctx.msg;
      if (!msg) return;

      // Ignore the "General" topic, other bots, and commands / internal notes.
      if (!msg.is_topic_message || msg.message_thread_id === undefined) return;
      if (ctx.from?.is_bot) return;
      if ((msg.text ?? "").startsWith("/")) return;

      const userId = deps.topics.findUserIdByThread(msg.message_thread_id);
      if (userId === undefined) {
        logger.debug(`No user mapped to topic ${msg.message_thread_id}, ignoring`);
        return;
      }

      try {
        await ctx.copyMessage(userId);
      } catch (err) {
        await reportDeliveryFailure(ctx, err);
      }
    });
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
