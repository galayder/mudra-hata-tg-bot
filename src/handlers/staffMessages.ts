import { GrammyError, type Bot, type Context, type FilterQuery } from "grammy";
import type { ConversationRepository } from "../db/conversationRepository";
import type { ParticipantRepository } from "../db/participantRepository";
import type { SettingsRepository } from "../db/settingsRepository";
import { detectLang, TEXTS } from "../i18n";
import { logger } from "../logger";
import type { QuestionCloser } from "../services/questionCloser";
import type { TopicManager } from "../services/topicManager";

export interface StaffHandlerDeps {
  topics: TopicManager;
  supportGroupId: number;
  settings: SettingsRepository;
  participants: ParticipantRepository;
  conversations: ConversationRepository;
  closer: QuestionCloser;
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

  // /resolve and /close inside a user's topic: same as the header buttons.
  for (const [command, outcome] of [["resolve", "resolved"], ["close", "closed"]] as const) {
    group.command(command, async (ctx) => {
      const threadId = ctx.msg.is_topic_message ? ctx.msg.message_thread_id : undefined;
      const user = threadId === undefined ? undefined : deps.topics.findUserByThread(threadId);
      if (user === undefined) {
        await ctx.reply(`Use /${command} inside a user's topic.`, replyTo(ctx));
        return;
      }
      const done = await deps.closer.closeByStaff(user.userId, outcome, ctx.from?.first_name ?? "staff");
      if (!done) await ctx.reply("There is no open question to close.", replyTo(ctx));
    });
  }

  // Quick-action buttons on a question's header.
  bot.callbackQuery(/^q:(resolve|close):(\d+)$/, async (ctx) => {
    const message = ctx.callbackQuery.message;
    if (message?.chat.id !== deps.supportGroupId) {
      await ctx.answerCallbackQuery();
      return;
    }
    const userId = Number(ctx.match[2]);
    const conversation = deps.conversations.get(userId);
    // Only the header of the user's current open question acts; older headers are stale.
    if (conversation?.status !== "open" || conversation.headerMessageId !== message.message_id) {
      await ctx.answerCallbackQuery({ text: "This question is already closed.", show_alert: true });
      await ctx.editMessageReplyMarkup().catch(() => undefined);
      return;
    }
    const outcome = ctx.match[1] === "resolve" ? "resolved" : "closed";
    const done = await deps.closer.closeByStaff(userId, outcome, ctx.from.first_name);
    await ctx.answerCallbackQuery(done ? { text: outcome === "resolved" ? "Resolved ✅" : "Closed 🔒" } : {});
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
