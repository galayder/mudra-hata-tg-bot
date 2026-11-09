import { InlineKeyboard, type Api } from "grammy";
import { categoryKeyboard } from "../categories";
import type { ConversationRepository } from "../db/conversationRepository";
import type { SettingsRepository } from "../db/settingsRepository";
import { detectLang, TEXTS } from "../i18n";
import { logger } from "../logger";
import { profileFromRecord, type TopicManager } from "./topicManager";

/**
 * How a question ended:
 * - resolved / closed: by staff (button or /resolve, /close)
 * - unanswered: timed out and the user wrote last (support never replied)
 * - inactive: timed out after staff replied
 */
export type Outcome = "resolved" | "closed" | "unanswered" | "inactive";

const TOPIC_ICON: Record<Outcome, string> = {
  resolved: "✅",
  closed: "🔒",
  unanswered: "⏰",
  inactive: "✅",
};

export interface QuestionCloserDeps {
  api: Api;
  topics: TopicManager;
  conversations: ConversationRepository;
  settings: SettingsRepository;
  supportGroupId: number;
  idleMs: number;
  supportPhone: string;
}

/** Quick-action buttons on a question's header in the support group. Callback data: "q:<action>:<userId>". */
export function questionActions(userId: number): InlineKeyboard {
  return new InlineKeyboard().text("✅ Resolved", `q:resolve:${userId}`).text("🔒 Close", `q:close:${userId}`);
}

/** The one place a question gets closed, so buttons, commands and timeouts behave the same. */
export class QuestionCloser {
  constructor(private readonly deps: QuestionCloserDeps) {}

  /** Staff action. Returns false if the user has no open question. */
  async closeByStaff(userId: number, outcome: "resolved" | "closed", staffName: string): Promise<boolean> {
    const headerMessageId = this.deps.conversations.get(userId)?.headerMessageId;
    if (!this.deps.conversations.close(userId)) return false;
    const verb = outcome === "resolved" ? "Resolved" : "Closed";
    await this.finish(userId, outcome, headerMessageId, `${TOPIC_ICON[outcome]} ${verb} by ${staffName}`);
    return true;
  }

  /** Timeout. The caller has already closed the question (atomically, see ConversationRepository.closeIfIdle). */
  async finishIdle(userId: number, outcome: "unanswered" | "inactive", headerMessageId: number | null): Promise<void> {
    const hours = Math.round((this.deps.idleMs / 3_600_000) * 10) / 10;
    const note =
      outcome === "unanswered"
        ? `⏰ Closed after ${hours} h without a reply. The user was given the support phone number.`
        : `✅ Closed after ${hours} h of inactivity.`;
    await this.finish(userId, outcome, headerMessageId, note);
  }

  private async finish(
    userId: number,
    outcome: Outcome,
    headerMessageId: number | null | undefined,
    note: string,
  ): Promise<void> {
    const { api, topics, settings, supportGroupId } = this.deps;
    const user = topics.findUser(userId);

    // Support group side: best effort, never blocks telling the user.
    if (user) {
      await topics.setStatus(profileFromRecord(user), user.threadId, TOPIC_ICON[outcome]);
      if (headerMessageId) {
        // No reply_markup → the quick-action buttons are removed.
        await api.editMessageReplyMarkup(supportGroupId, headerMessageId).catch((err: unknown) => {
          logger.debug(`Could not remove buttons from header ${headerMessageId}`, err);
        });
      }
      await api.sendMessage(supportGroupId, note, { message_thread_id: user.threadId }).catch((err: unknown) => {
        logger.warn(`Could not post the close note in topic ${user.threadId}`, err);
      });
    }

    const lang = settings.getLang(userId) ?? detectLang(user?.languageCode ?? undefined);
    const text =
      outcome === "resolved"
        ? TEXTS[lang].resolved
        : outcome === "unanswered"
          ? TEXTS[lang].timeoutApology.replace("{phone}", this.deps.supportPhone)
          : TEXTS[lang].closed;
    try {
      await api.sendMessage(userId, text, { reply_markup: categoryKeyboard(lang) });
    } catch (err) {
      logger.warn(`Could not tell user ${userId} their question was closed`, err);
      if (user) {
        await api
          .sendMessage(supportGroupId, "⚠️ The user could not be notified (they may have blocked the bot).", {
            message_thread_id: user.threadId,
          })
          .catch(() => undefined);
      }
    }
    logger.info(`Question of user ${userId} closed: ${outcome}`);
  }
}
