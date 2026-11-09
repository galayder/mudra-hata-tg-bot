import { categoryKeyboard } from "../categories";
import type { ConversationRepository } from "../db/conversationRepository";
import type { SettingsRepository } from "../db/settingsRepository";
import { detectLang, TEXTS } from "../i18n";
import { logger } from "../logger";
import { profileFromRecord, type TopicManager } from "./topicManager";
import type { Api } from "grammy";

export interface IdleSweeperDeps {
  api: Api;
  topics: TopicManager;
  conversations: ConversationRepository;
  settings: SettingsRepository;
  supportGroupId: number;
  idleMs: number;
  supportPhone: string;
}

const SWEEP_EVERY_MS = 60_000;

/**
 * Closes questions with no messages from either side for `idleMs`, once a minute.
 * - Last message from the user (support never answered): apologize, give the phone number,
 *   mark the topic ⏰ so staff can spot missed questions.
 * - Last message from staff: the usual "request closed" message, topic ✅.
 * In both cases the user gets the topic keyboard to ask again.
 */
export class IdleSweeper {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(private readonly deps: IdleSweeperDeps) {}

  start(): void {
    this.timer = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    void this.sweep();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  async sweep(): Promise<void> {
    if (this.running) return; // a slow sweep (rate limits) must not overlap the next one
    this.running = true;
    try {
      const cutoff = Date.now() - this.deps.idleMs;
      for (const { userId, lastActor } of this.deps.conversations.expired(cutoff)) {
        // Re-checked atomically: skips a question that got a message since the query above.
        if (!this.deps.conversations.closeIfIdle(userId, cutoff)) continue;
        await this.notify(userId, lastActor === "user").catch((err: unknown) => {
          logger.warn(`Could not notify user ${userId} about the idle close`, err);
        });
      }
    } catch (err) {
      logger.error("Idle sweep failed", err);
    } finally {
      this.running = false;
    }
  }

  private async notify(userId: number, unanswered: boolean): Promise<void> {
    const { api, topics, settings, supportGroupId } = this.deps;
    const user = topics.findUser(userId);
    const lang = settings.getLang(userId) ?? detectLang(user?.languageCode ?? undefined);
    const hours = Math.round((this.deps.idleMs / 3_600_000) * 10) / 10;

    if (user) {
      await topics.setStatus(profileFromRecord(user), user.threadId, unanswered ? "⏰" : "✅");
      const note = unanswered
        ? `⏰ Closed after ${hours} h without a reply. The user was given the support phone number.`
        : `✅ Closed after ${hours} h of inactivity.`;
      await api.sendMessage(supportGroupId, note, { message_thread_id: user.threadId }).catch((err: unknown) => {
        logger.warn(`Could not post the idle-close note in topic ${user.threadId}`, err);
      });
    }

    const text = unanswered
      ? TEXTS[lang].timeoutApology.replace("{phone}", this.deps.supportPhone)
      : TEXTS[lang].closed;
    await api.sendMessage(userId, text, { reply_markup: categoryKeyboard(lang) });
    logger.info(`Closed idle question of user ${userId} (${unanswered ? "unanswered" : "answered"})`);
  }
}
