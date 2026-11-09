import type { ConversationRepository } from "../db/conversationRepository";
import { logger } from "../logger";
import type { QuestionCloser } from "./questionCloser";

const SWEEP_EVERY_MS = 60_000;

/**
 * Once a minute, closes questions with no messages from either side for `idleMs`.
 * If the user wrote last (support never answered) the user gets an apology with the
 * support phone number; otherwise the usual "request closed" message. See QuestionCloser.
 */
export class IdleSweeper {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly conversations: ConversationRepository,
    private readonly closer: QuestionCloser,
    private readonly idleMs: number,
  ) {}

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
      const cutoff = Date.now() - this.idleMs;
      for (const { userId, lastActor, headerMessageId } of this.conversations.expired(cutoff)) {
        // Re-checked atomically: skips a question that got a message since the query above.
        if (!this.conversations.closeIfIdle(userId, cutoff)) continue;
        await this.closer
          .finishIdle(userId, lastActor === "user" ? "unanswered" : "inactive", headerMessageId)
          .catch((err: unknown) => logger.warn(`Could not finish idle close for user ${userId}`, err));
      }
    } catch (err) {
      logger.error("Idle sweep failed", err);
    } finally {
      this.running = false;
    }
  }
}
