import type { Bot, Context } from "grammy";
import type { SettingsRepository } from "../db/settingsRepository";
import type { UserProfile } from "../db/userRepository";
import { detectLang, type Lang } from "../i18n";
import { logger } from "../logger";
import { isMissingTopicError, type TopicManager } from "../services/topicManager";

export interface UserHandlerDeps {
  topics: TopicManager;
  supportGroupId: number;
  settings: SettingsRepository;
  greetingText: Record<Lang, string>;
}

/**
 * Private chat → user's topic in the support group.
 * Register after the menu handlers so /start, /settings and menu buttons are not forwarded.
 */
export function registerUserHandlers(bot: Bot, deps: UserHandlerDeps): void {
  const privateChat = bot.chatType("private");

  privateChat.on("message", async (ctx) => {
    const from = ctx.from;
    const profile: UserProfile = {
      userId: from.id,
      firstName: from.first_name,
      lastName: from.last_name,
      username: from.username,
    };

    let { threadId, isFirstContact } = await deps.topics.resolve(profile);

    try {
      await copyToTopic(ctx, deps.supportGroupId, threadId);
    } catch (err) {
      if (!isMissingTopicError(err)) throw err;
      logger.warn(`Topic ${threadId} for user ${from.id} is gone, recreating`);
      ({ threadId } = await deps.topics.recreate(profile));
      await copyToTopic(ctx, deps.supportGroupId, threadId);
    }

    if (isFirstContact) {
      const lang = deps.settings.getLang(from.id) ?? detectLang(from.language_code);
      await ctx.reply(deps.greetingText[lang]);
    }
  });
}

async function copyToTopic(ctx: Context, groupId: number, threadId: number): Promise<void> {
  await ctx.copyMessage(groupId, { message_thread_id: threadId });
}
