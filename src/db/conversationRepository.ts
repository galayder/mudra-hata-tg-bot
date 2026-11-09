import { isCategory, type Category } from "../categories";
import type { DB } from "./database";

/** Who wrote the last message in a question. */
export type Actor = "user" | "staff";

/**
 * The user's current question ("conversation"). A user has at most one at a time.
 * - category NULL: a new question was started but the user has not picked a topic yet
 * - announced 0: the topic header has not been posted to the support group yet
 */
export interface Conversation {
  category: Category | null;
  status: "open" | "closed";
  announced: boolean;
  lastActivity: number;
}

interface Row {
  category: string | null;
  status: string;
  announced: number;
  last_activity: number;
}

export class ConversationRepository {
  private readonly getStmt;
  private readonly startStmt;
  private readonly announcedStmt;
  private readonly touchStmt;
  private readonly closeStmt;
  private readonly expiredStmt;
  private readonly closeIfIdleStmt;

  constructor(
    db: DB,
    /** A question with no messages from either side for this long is over. */
    private readonly idleMs: number,
  ) {
    this.getStmt = db.prepare<[number], Row>(
      "SELECT category, status, announced, last_activity FROM conversations WHERE user_id = ?",
    );
    this.startStmt = db.prepare<[number, string | null, number]>(
      `INSERT INTO conversations (user_id, category, status, announced, last_activity, last_actor)
       VALUES (?, ?, 'open', 0, ?, 'user')
       ON CONFLICT(user_id) DO UPDATE SET
         category = excluded.category, status = 'open', announced = 0,
         last_activity = excluded.last_activity, last_actor = 'user'`,
    );
    this.announcedStmt = db.prepare<[number]>("UPDATE conversations SET announced = 1 WHERE user_id = ?");
    this.touchStmt = db.prepare<[number, string, number]>(
      "UPDATE conversations SET last_activity = ?, last_actor = ? WHERE user_id = ? AND status = 'open'",
    );
    // Only questions that reached the support group: a topic picked and the header posted.
    this.expiredStmt = db.prepare<[number], { user_id: number; last_actor: string }>(
      `SELECT user_id, last_actor FROM conversations
       WHERE status = 'open' AND category IS NOT NULL AND announced = 1 AND last_activity < ?`,
    );
    this.closeIfIdleStmt = db.prepare<[number, number]>(
      "UPDATE conversations SET status = 'closed' WHERE user_id = ? AND status = 'open' AND last_activity < ?",
    );
    this.closeStmt = db.prepare<[number]>(
      "UPDATE conversations SET status = 'closed' WHERE user_id = ? AND status = 'open'",
    );
  }

  get(userId: number): Conversation | undefined {
    const row = this.getStmt.get(userId);
    if (!row) return undefined;
    return {
      category: isCategory(row.category) ? row.category : null,
      status: row.status === "closed" ? "closed" : "open",
      announced: row.announced === 1,
      lastActivity: row.last_activity,
    };
  }

  /**
   * The user's question that is still going: open, with a topic picked, and not idle.
   * Returns undefined when the next message should start a new question.
   */
  active(userId: number): Conversation | undefined {
    const c = this.get(userId);
    if (!c || c.status !== "open" || c.category === null) return undefined;
    return Date.now() - c.lastActivity < this.idleMs ? c : undefined;
  }

  /** True when the user started a new question and still has to pick its topic. */
  awaitingCategory(userId: number): boolean {
    const c = this.get(userId);
    return c !== undefined && c.status === "open" && c.category === null;
  }

  /** Starts a new question, with or without a topic yet. Replaces the previous one. */
  start(userId: number, category: Category | null): void {
    this.startStmt.run(userId, category, Date.now());
  }

  markAnnounced(userId: number): void {
    this.announcedStmt.run(userId);
  }

  /** Records a message in the open question from the user or from staff. */
  touch(userId: number, actor: Actor): void {
    this.touchStmt.run(Date.now(), actor, userId);
  }

  /** Delivered questions with no messages since `cutoff`. */
  expired(cutoff: number): { userId: number; lastActor: Actor }[] {
    return this.expiredStmt.all(cutoff).map((row) => ({
      userId: row.user_id,
      lastActor: row.last_actor === "staff" ? "staff" : "user",
    }));
  }

  /** Closes the question only if it is still open and still idle. Returns true if it closed it. */
  closeIfIdle(userId: number, cutoff: number): boolean {
    return this.closeIfIdleStmt.run(userId, cutoff).changes > 0;
  }

  /** Returns true if an open question was closed. */
  close(userId: number): boolean {
    return this.closeStmt.run(userId).changes > 0;
  }
}
