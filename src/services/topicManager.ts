import { GrammyError, type Api } from "grammy";
import type { UserProfile, UserRecord, UserRepository } from "../db/userRepository";
import { logger } from "../logger";

export interface TopicResolution {
  threadId: number;
  /** True when the user had no topic before this call (their very first message). */
  isFirstContact: boolean;
}

const TOPIC_NAME_LIMIT = 128;

/** Telegram errors meaning the stored topic no longer exists in the group. */
export function isMissingTopicError(err: unknown): boolean {
  if (!(err instanceof GrammyError)) return false;
  const text = err.description.toLowerCase();
  return text.includes("thread not found") || text.includes("topic_deleted");
}

export function displayName(profile: UserProfile): string {
  return [profile.firstName, profile.lastName].filter(Boolean).join(" ") || `User ${profile.userId}`;
}

/** Topic title: optional status prefix (e.g. "🟢🐞"), then "Name (@username)", within Telegram's 128 chars. */
export function profileFromRecord(user: UserRecord): UserProfile {
  return {
    userId: user.userId,
    firstName: user.firstName,
    lastName: user.lastName ?? undefined,
    username: user.username ?? undefined,
    languageCode: user.languageCode ?? undefined,
  };
}

function topicName(profile: UserProfile, prefix = ""): string {
  const lead = prefix ? `${prefix} ` : "";
  const suffix = profile.username ? ` (@${profile.username})` : ` (${profile.userId})`;
  const base = displayName(profile);
  const maxBase = TOPIC_NAME_LIMIT - suffix.length - lead.length;
  const trimmed = base.length > maxBase ? `${base.slice(0, maxBase - 1)}…` : base;
  return lead + trimmed + suffix;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Owns the user ⇄ forum-topic mapping: finds the user's topic,
 * creates one on demand, and recreates it if staff deleted it.
 */
export class TopicManager {
  /** Guards against creating two topics when a new user sends several messages at once. */
  private readonly pending = new Map<number, Promise<TopicResolution>>();

  constructor(
    private readonly api: Api,
    private readonly users: UserRepository,
    private readonly groupId: number,
  ) {}

  /** Returns the user's topic, creating it if needed. */
  async resolve(profile: UserProfile): Promise<TopicResolution> {
    const existing = this.users.findByUserId(profile.userId);
    if (existing) {
      // Keep name/username/language fresh.
      if (
        existing.username !== (profile.username ?? null) ||
        existing.firstName !== profile.firstName ||
        existing.languageCode !== (profile.languageCode ?? null)
      ) {
        this.users.save(profile, existing.threadId);
      }
      return { threadId: existing.threadId, isFirstContact: false };
    }
    return this.createOnce(profile, true);
  }

  /** Drops a topic that no longer exists and creates a fresh one. */
  async recreate(profile: UserProfile): Promise<TopicResolution> {
    this.users.delete(profile.userId);
    return this.createOnce(profile, false);
  }

  /** Maps a topic in the support group back to the user who owns it. */
  findUserByThread(threadId: number): UserRecord | undefined {
    return this.users.findByThreadId(threadId);
  }

  findUser(userId: number): UserRecord | undefined {
    return this.users.findByUserId(userId);
  }

  /**
   * Renames the topic to show the question's status, e.g. "🟢🐞 Ann (@ann)" or "✅ Ann (@ann)".
   * Best effort: a failed rename (e.g. "TOPIC_NOT_MODIFIED") never blocks delivery.
   */
  async setStatus(profile: UserProfile, threadId: number, prefix: string): Promise<void> {
    await this.api.editForumTopic(this.groupId, threadId, { name: topicName(profile, prefix) }).catch((err: unknown) => {
      logger.debug(`Could not rename topic ${threadId}`, err instanceof GrammyError ? err.description : err);
    });
  }

  private createOnce(profile: UserProfile, isFirstContact: boolean): Promise<TopicResolution> {
    const inFlight = this.pending.get(profile.userId);
    if (inFlight) return inFlight.then((r) => ({ ...r, isFirstContact: false }));

    const promise = this.create(profile, isFirstContact).finally(() => {
      this.pending.delete(profile.userId);
    });
    this.pending.set(profile.userId, promise);
    return promise;
  }

  private async create(profile: UserProfile, isFirstContact: boolean): Promise<TopicResolution> {
    const topic = await this.api.createForumTopic(this.groupId, topicName(profile));
    const threadId = topic.message_thread_id;
    this.users.save(profile, threadId);
    logger.info(`Created topic ${threadId} for user ${profile.userId}`);

    await this.postUserCard(profile, threadId).catch((err: unknown) => {
      logger.warn(`Could not post user card in topic ${threadId}`, err);
    });

    return { threadId, isFirstContact };
  }

  private async postUserCard(profile: UserProfile, threadId: number): Promise<void> {
    const lines = [
      `👤 <b>${escapeHtml(displayName(profile))}</b>`,
      profile.username ? `Username: @${escapeHtml(profile.username)}` : "Username: —",
      `ID: <code>${profile.userId}</code>`,
      `Profile: <a href="tg://user?id=${profile.userId}">open</a>`,
      "",
      "Reply in this topic to answer the user. Messages starting with / are not sent.",
    ];
    await this.api.sendMessage(this.groupId, lines.join("\n"), {
      message_thread_id: threadId,
      parse_mode: "HTML",
    });
  }
}
