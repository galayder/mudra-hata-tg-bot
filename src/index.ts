import { checkSupportGroup, createBot } from "./bot";
import { setBotCommands } from "./handlers/menu";
import { loadConfig } from "./config";
import { openDatabase } from "./db/database";
import { logger, setLogLevel } from "./logger";

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  const db = openDatabase(config.dbPath);
  logger.info(`Database: ${config.dbPath}`);

  const bot = createBot(config, db);

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    logger.info(`${signal} received, shutting down`);
    await bot.stop();
    db.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await bot.init();
  await checkSupportGroup(bot, config.supportGroupId);
  await setBotCommands(bot).catch((err: unknown) => logger.warn("Could not set bot commands", err));

  // Long polling: no public URL or open port needed, which suits Pterodactyl hosts.
  await bot.start({
    drop_pending_updates: false,
    allowed_updates: ["message", "callback_query"],
    onStart: (me) => logger.info(`Bot @${me.username} started (support group ${config.supportGroupId})`),
  });
}

main().catch((err: unknown) => {
  logger.error("Fatal error", err instanceof Error ? err.message : err);
  process.exit(1);
});
