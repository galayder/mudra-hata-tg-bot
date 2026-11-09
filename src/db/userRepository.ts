import type { DB } from "./database";

export interface UserRecord {
  userId: number;
  threadId: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface UserProfile {
  userId: number;
  firstName: string;
  lastName?: string | undefined;
  username?: string | undefined;
}

interface UserRow {
  user_id: number;
  thread_id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  created_at: number;
  updated_at: number;
}

interface UpsertParams {
  userId: number;
  threadId: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  now: number;
}

function toRecord(row: UserRow): UserRecord {
  return {
    userId: row.user_id,
    threadId: row.thread_id,
    firstName: row.first_name,
    lastName: row.last_name,
    username: row.username,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class UserRepository {
  private readonly byUserId;
  private readonly byThreadId;
  private readonly upsert;
  private readonly removeByUserId;

  constructor(db: DB) {
    this.byUserId = db.prepare<[number], UserRow>("SELECT * FROM users WHERE user_id = ?");
    this.byThreadId = db.prepare<[number], UserRow>("SELECT * FROM users WHERE thread_id = ?");
    this.upsert = db.prepare<[UpsertParams]>(
      `INSERT INTO users (user_id, thread_id, first_name, last_name, username, created_at, updated_at)
       VALUES (@userId, @threadId, @firstName, @lastName, @username, @now, @now)
       ON CONFLICT(user_id) DO UPDATE SET
         thread_id  = excluded.thread_id,
         first_name = excluded.first_name,
         last_name  = excluded.last_name,
         username   = excluded.username,
         updated_at = excluded.updated_at`,
    );
    this.removeByUserId = db.prepare<[number]>("DELETE FROM users WHERE user_id = ?");
  }

  findByUserId(userId: number): UserRecord | undefined {
    const row = this.byUserId.get(userId);
    return row ? toRecord(row) : undefined;
  }

  findByThreadId(threadId: number): UserRecord | undefined {
    const row = this.byThreadId.get(threadId);
    return row ? toRecord(row) : undefined;
  }

  save(profile: UserProfile, threadId: number): void {
    this.upsert.run({
      userId: profile.userId,
      threadId,
      firstName: profile.firstName,
      lastName: profile.lastName ?? null,
      username: profile.username ?? null,
      now: Date.now(),
    });
  }

  delete(userId: number): void {
    this.removeByUserId.run(userId);
  }
}
