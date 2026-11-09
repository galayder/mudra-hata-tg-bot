import type { DB } from "./database";

/**
 * Users' phone numbers, plus the private-chat messages held back until the user shares one.
 * Held messages stay in the user's chat; only their IDs are stored, then copied once the phone arrives.
 */
export class ContactRepository {
  private readonly getPhoneStmt;
  private readonly setPhoneStmt;
  private readonly queueStmt;
  private readonly pendingStmt;
  private readonly clearStmt;

  constructor(db: DB) {
    this.getPhoneStmt = db.prepare<[number], { phone: string }>("SELECT phone FROM user_phones WHERE user_id = ?");
    this.setPhoneStmt = db.prepare<[number, string, number]>(
      `INSERT INTO user_phones (user_id, phone, shared_at) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET phone = excluded.phone, shared_at = excluded.shared_at`,
    );
    this.queueStmt = db.prepare<[number, number, number]>(
      "INSERT OR IGNORE INTO pending_messages (user_id, message_id, created_at) VALUES (?, ?, ?)",
    );
    this.pendingStmt = db.prepare<[number], { message_id: number }>(
      "SELECT message_id FROM pending_messages WHERE user_id = ? ORDER BY message_id",
    );
    this.clearStmt = db.prepare<[number]>("DELETE FROM pending_messages WHERE user_id = ?");
  }

  getPhone(userId: number): string | undefined {
    return this.getPhoneStmt.get(userId)?.phone;
  }

  setPhone(userId: number, phone: string): void {
    this.setPhoneStmt.run(userId, phone, Date.now());
  }

  /** Holds a message back. Returns true if it is the first one waiting (so the caller asks for the phone once). */
  hold(userId: number, messageId: number): boolean {
    const wasEmpty = this.pendingStmt.get(userId) === undefined;
    this.queueStmt.run(userId, messageId, Date.now());
    return wasEmpty;
  }

  pending(userId: number): number[] {
    return this.pendingStmt.all(userId).map((row) => row.message_id);
  }

  clearPending(userId: number): void {
    this.clearStmt.run(userId);
  }
}
