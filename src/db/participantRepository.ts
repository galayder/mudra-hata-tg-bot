import type { DB } from "./database";

/** Which support staff have already been introduced to which user ("X joined the chat"). */
export class ParticipantRepository {
  private readonly existsStmt;
  private readonly insertStmt;

  constructor(db: DB) {
    this.existsStmt = db.prepare<[number, number], { 1: number }>(
      "SELECT 1 FROM chat_participants WHERE user_id = ? AND staff_id = ?",
    );
    this.insertStmt = db.prepare<[number, number, number]>(
      "INSERT OR IGNORE INTO chat_participants (user_id, staff_id, joined_at) VALUES (?, ?, ?)",
    );
  }

  hasJoined(userId: number, staffId: number): boolean {
    return this.existsStmt.get(userId, staffId) !== undefined;
  }

  markJoined(userId: number, staffId: number): void {
    this.insertStmt.run(userId, staffId, Date.now());
  }
}
