import { isCategory, type Category } from "../categories";
import type { DB } from "./database";

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

  constructor(
    db: DB,
    /** A question with no messages from either side for this long is over. */
    private readonly idleMs: number,
  ) {
    this.getStmt = db.prepare<[number], Row>(
      "SELECT category, status, announced, last_activity FROM conversations WHERE user_id = ?",
    );
    this.startStmt = db.prepare<[number, string | null, number]>(
      `INSERT INTO conversations (user_id, category, status, announced, last_activity) VALUES (?, ?, 'open', 0, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         category = excluded.category, status = 'open', announced = 0, last_activity = excluded.last_activity`,
    );
    this.announcedStmt = db.prepare<[number]>("UPDATE conversations SET announced = 1 WHERE user_id = ?");
    this.touchStmt = db.prepare<[number, number]>(
      "UPDATE conversations SET last_activity = ? WHERE user_id = ? AND status = 'open'",
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

  touch(userId: number): void {
    this.touchStmt.run(Date.now(), userId);
  }

  /** Returns true if an open question was closed. */
  close(userId: number): boolean {
    return this.closeStmt.run(userId).changes > 0;
  }
}
