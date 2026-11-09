import { Bot, GrammyError, HttpError } from "grammy";
import { autoRetry } from "@grammyjs/auto-retry";
import type { Config } from "./config";
import type { DB } from "./db/database";
import { ContactRepository } from "./db/contactRepository";
import { ConversationRepository } from "./db/conversationRepository";
import { ParticipantRepository } from "./db/participantRepository";
import { SettingsRepository } from "./db/settingsRepository";
import { UserRepository } from "./db/userRepository";
import { registerMenuHandlers } from "./handlers/menu";
import { registerStaffHandlers } from "./handlers/staffMessages";
import { registerUserHandlers } from "./handlers/userMessages";
import { logger } from "./logger";
import { TopicManager } from "./services/topicManager";

export function createBot(config: Config, db: DB): Bot {
  const bot = new Bot(config.botToken);

  // Transparently wait and retry on 429 (flood control) and 5xx errors.
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 60 }));

  const topics = new TopicManager(bot.api, new UserRepository(db), config.supportGroupId);

  // Helper for setup: send /chatid in any group to learn its ID.
  bot.command("chatid", async (ctx) => {
    await ctx.reply(`Chat ID: <code>${ctx.chat.id}</code>`, {
      parse_mode: "HTML",
      ...(ctx.msg.message_thread_id !== undefined && ctx.msg.is_topic_message
        ? { message_thread_id: ctx.msg.message_thread_id }
        : {}),
    });
  });

  const settings = new SettingsRepository(db);
  const conversations = new ConversationRepository(db, config.sessionIdleMs);

  // Order matters: menu commands/buttons must be handled before the catch-all forwarder.
  registerMenuHandlers(bot, { settings, conversations, startText: config.startText });
  registerUserHandlers(bot, {
    topics,
    settings,
    contacts: new ContactRepository(db),
    conversations,
    supportGroupId: config.supportGroupId,
    greetingText: config.greetingText,
  });
  registerStaffHandlers(bot, {
    topics,
    settings,
    participants: new ParticipantRepository(db),
    conversations,
    supportGroupId: config.supportGroupId,
  });

  bot.catch(({ error, ctx }) => {
    const where = `update ${ctx.update.update_id}`;
    if (error instanceof GrammyError) logger.error(`Telegram API error in ${where}: ${error.description}`);
    else if (error instanceof HttpError) logger.error(`Network error in ${where}`, error.error);
    else logger.error(`Unhandled error in ${where}`, error);
  });

  return bot;
}

/** Logs actionable warnings if the support group is misconfigured. Never throws. */
export async function checkSupportGroup(bot: Bot, groupId: number): Promise<void> {
  try {
    const chat = await bot.api.getChat(groupId);
    if (chat.type !== "supergroup" || !chat.is_forum) {
      logger.warn(`Chat ${groupId} is not a supergroup with Topics enabled — enable Topics in group settings.`);
    }
    const me = await bot.api.getChatMember(groupId, bot.botInfo.id);
    if (me.status !== "administrator" || !me.can_manage_topics) {
      logger.warn(`Bot is not an admin with the "Manage Topics" right in ${groupId} — topics cannot be created.`);
    }
  } catch (err) {
    const reason = err instanceof GrammyError ? err.description : String(err);
    logger.warn(`Cannot access support group ${groupId} (${reason}). Is the bot added to the group?`);
  }
}
