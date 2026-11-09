import type { Bot, Context } from "grammy";
import type { UserProfile } from "../db/userRepository";
import { logger } from "../logger";
import { isMissingTopicError, type TopicManager } from "../services/topicManager";

export interface UserHandlerDeps {
  topics: TopicManager;
  supportGroupId: number;
  greetingText: string;
  startText: string;
}

/** Private chat → user's topic in the support group. */
export function registerUserHandlers(bot: Bot, deps: UserHandlerDeps): void {
  const privateChat = bot.chatType("private");

  privateChat.command("start", async (ctx) => {
    await ctx.reply(deps.startText);
  });

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
      await ctx.reply(deps.greetingText);
    }
  });
}

async function copyToTopic(ctx: Context, groupId: number, threadId: number): Promise<void> {
  await ctx.copyMessage(groupId, { message_thread_id: threadId });
}
