# mudra-hata-tg-bot

A Telegram support bot built with Node.js, TypeScript and [grammY](https://grammy.dev).

It connects private chats with a support team working in one Telegram group:

- A user writes to the bot in a private chat.
- The bot creates a topic for that user in a support supergroup that has **Topics** turned on. Each user gets one topic.
- The user's messages are copied into their topic: text, photos, files, voice messages, stickers, and so on.
- When someone on the team replies inside a topic, the bot sends that reply to the user's private chat.
- The first time a user writes, the bot automatically replies that the message was received and is being processed.
- Telegram's **Menu** button lists `/start`, `/settings` and `/website`. The bot speaks Ukrainian and English: by default it follows the user's Telegram language, and users can change it in **Settings**. Messages for the support team stay in English.

The mapping from user to topic is stored in SQLite (`./data/bot.sqlite`). The bot uses long polling, so it needs no domain, no webhook and no open port. That makes it a good fit for Pterodactyl hosts such as [Bot-Hosting.net](https://bot-hosting.net/).

---

## How it behaves

| Situation | Result |
|---|---|
| User opens the bot for the first time | Telegram shows a **Start** button, which sends `/start`. |
| User sends `/start` before choosing a language | The bot replies with the start text plus 🇺🇦 Українська / 🇬🇧 English buttons. Picking one saves it and replaces the message with the start text in that language. Nothing is forwarded. |
| User sends `/start` after choosing a language | The bot replies with the start text in their language. |
| User sends `/settings` | The bot shows the language picker. Picking a language saves it and confirms the change. |
| User sends `/website` | The bot replies with a button that opens the website (`WEBSITE_URL`, default https://mudrahata.com). |
| User starts a new question (first message ever, after staff `/close`, or after `SESSION_IDLE_HOURS` of silence) | The message is held. The bot asks for a topic with a keyboard: **🐞 Проблема / Problem** and **💡 Запропонувати функцію / Request a feature**. The Bot API can't disable typing, so anything typed meanwhile is held too. |
| User picks a topic | If the user has never shared a phone number, the bot asks for it with a **📱 Share phone number** button (Telegram's `request_contact`). Otherwise the held messages are delivered. |
| User shares their phone number | It's saved once and reused for later questions. Sending someone else's contact card is rejected. |
| A question is delivered for the first time | In the user's support topic the bot posts `🆕 New question · 🏷 Topic · 📱 Phone`, renames the topic to `🟢🐞 Name` or `🟢💡 Name`, copies all held messages in order, and sends the user the greeting. The header has quick-action buttons **✅ Resolved** and **🔒 Close**. |
| User sends any later message | The message is copied into their topic while the question is still open. |
| A staff member taps **✅ Resolved** on the question header, or sends `/resolve` in the topic | The question is closed as solved: the buttons are removed, `✅ Resolved by {name}` is posted, the topic is renamed `✅ Name`, and the user is told the question was resolved and shown the topic keyboard. |
| A staff member taps **🔒 Close**, or sends `/close` | The same, but as closed without a resolution (e.g. spam or a duplicate): topic `🔒 Name`, the user gets "your request has been closed". Buttons on an older question's header only show "This question is already closed". |
| A question gets no messages from either side for `SESSION_IDLE_HOURS` | The bot closes it automatically (checked every minute). If the user wrote last (support never answered), the user gets an apology with `SUPPORT_PHONE` and the topic is renamed `⏰ Name`. If staff wrote last, the user gets the usual "request closed" message and the topic becomes `✅ Name`. Either way the user sees the topic keyboard again. |
| A staff member writes in a user's topic | The message is copied to that user. |
| A staff member replies for the first time in a question | Before the reply, the user gets "👤 {first name} joined the chat" in their language. This happens once per staff member per question. |
| A staff member writes a message starting with `/` | The message is **not** sent. Use this for internal notes, for example `/note checking with billing`. |
| A message is posted in the *General* topic | The bot ignores it. |
| A staff member deleted the user's topic | The user's open question ends. Their next message is held, they are asked to pick a topic again, and a new topic is created for the new question. |
| The user blocked the bot | The bot posts "⚠️ Not delivered" in the topic. |
| `/chatid` is sent in any chat | The bot replies with the chat's ID. This helps during setup. |

## Project structure

```
src/
  index.ts                  Entry point: loads config, opens the DB, starts long polling, handles shutdown
  bot.ts                    Builds the bot, registers handlers, handles errors, checks the group on startup
  config.ts                 Reads and validates environment variables (.env)
  logger.ts                 Small logger with log levels
  categories.ts             Question topics (Problem, Request a feature) and their keyboard
  i18n.ts                   Languages (uk, en), language detection and user-facing texts
  db/
    database.ts             Opens SQLite (WAL mode) and applies schema migrations
    userRepository.ts       User ⇄ topic mapping (typed queries)
    settingsRepository.ts   Per-user settings (chosen language)
    contactRepository.ts    Phone numbers and messages held until they can be delivered
    conversationRepository.ts  The user's current question: topic, open/closed, last activity
    participantRepository.ts  Staff already introduced to each user ("X joined the chat")
  services/
    questionCloser.ts       Closes a question (buttons, /resolve, /close, timeout): topic status, notes, user message
    idleSweeper.ts          Closes questions after SESSION_IDLE_HOURS of silence and notifies the user
    topicManager.ts         Finds, creates and recreates topics; no duplicate topics on simultaneous messages
  handlers/
    menu.ts                 /start, /settings, the language picker and the commands behind the Menu button
    userMessages.ts         Private chat → the user's topic (with the first-contact greeting)
    staffMessages.ts        Topic reply → the user's private chat
data/                       The SQLite database is created here (keep this folder on the host)
```

## Configuration

All settings come from environment variables. The bot reads them from a `.env` file in the project root, or from the real environment; if both set a variable, the real environment wins. Use [`.env.example`](.env.example) as a template.

| Variable | Required | Default | Description |
|---|---|---|---|
| `BOT_TOKEN` | ✅ | — | The token you get from @BotFather |
| `SUPPORT_GROUP_ID` | ✅ | — | ID of the support supergroup, such as `-1001234567890` |
| `DB_PATH` | | `./data/bot.sqlite` | Where the SQLite file is stored |
| `GREETING_TEXT_UK`, `GREETING_TEXT_EN` | | *(receipt notice)* | Automatic reply to a user's first message, per language. Write `\n` for a line break. The old `GREETING_TEXT` still works as the English text. |
| `START_TEXT_UK`, `START_TEXT_EN` | | *(welcome text)* | Reply to `/start`, per language. The old `START_TEXT` still works as the English text. |
| `SESSION_IDLE_HOURS` | | `12` | After this many hours with no messages from the user or staff, the user's next message starts a new question with a topic choice |
| `WEBSITE_URL` | | `https://mudrahata.com` | Website opened by `/website` |
| `SUPPORT_PHONE` | | `+380505255167` | Phone number in the apology sent when a question times out without an answer |
| `LOG_LEVEL` | | `info` | One of `debug`, `info`, `warn`, `error` |

## Local development

The bot needs **Node.js 20 or newer**.

```bash
npm install
cp .env.example .env      # then fill in BOT_TOKEN and SUPPORT_GROUP_ID
npm run build
npm start
```

---

## Deploying to Bot-Hosting.net (Pterodactyl)

### 1. Create the bot with BotFather

1. In Telegram, open [@BotFather](https://t.me/BotFather) and send `/newbot`.
2. Choose a display name, then a username. The username must end in `bot`, for example `mudra_hata_support_bot`.
3. BotFather replies with a **token** that looks like `123456789:AAH...`. Copy it; you will use it as `BOT_TOKEN`. Keep it secret. If it leaks, revoke it with `/revoke`.
4. Optional: set a description and a profile picture with `/setdescription` and `/setuserpic`.

You can leave the bot's *Group Privacy* setting at its default. Group admins receive every group message, and the bot will be an admin.

### 2. Set up the support supergroup with Topics

1. Create a new group in Telegram and add your team members.
2. Open the group settings (✏️ **Edit**) and turn on **Topics**. Telegram converts the group into a supergroup at this point.
3. Add the bot as a member: **Add Members**, then search for its username.
4. Make the bot an **administrator**: **Administrators**, then **Add Admin**, then pick the bot. Give it at least:
   - **Manage Topics** (required to create a topic for each user)
   - **Delete Messages** and **Pin Messages** (optional)
5. Get the group's ID, which looks like `-100xxxxxxxxxx`. Either:
   - open the group in [web.telegram.org](https://web.telegram.org/a/). The address bar shows `#-100xxxxxxxxxx`, and that number is the ID; **or**
   - run the bot once with `SUPPORT_GROUP_ID=-1` as a placeholder, send `/chatid` in the group, copy the ID it replies with, then set the real value and restart. While the placeholder is set, the bot logs a warning that it can't reach the group; this is expected.

### 3. Create the server and set environment variables

1. On [Bot-Hosting.net](https://bot-hosting.net/), create a server and choose the **Node.js** type. Pick **Node 20 or newer** if the panel offers a version choice.
2. Open the server in the panel. To provide the variables, either:
   - **Option A (recommended): a `.env` file.** Go to **Files**, create a file named `.env` in the root folder (`/home/container`) and paste:
     ```env
     BOT_TOKEN=123456789:AAH...your-token
     SUPPORT_GROUP_ID=-1001234567890
     DB_PATH=./data/bot.sqlite
     GREETING_TEXT=Thanks for reaching out! Your message has been received and is being processed.
     ```
   - **Option B: the Startup tab.** If your server's **Startup** tab has fields for environment variables, enter `BOT_TOKEN`, `SUPPORT_GROUP_ID` and any others there. Pterodactyl panels usually only show the variables their server template defines, so on most servers Option A is the way to go.
3. In the **Startup** tab, set the startup settings:
   - **Main file** (often called `MAIN_FILE` or `BOT_JS_FILE`): `dist/index.js`
   - If the startup command can be edited, or the panel has a "run npm script" option, you can use `npm start` instead.

### 4. Upload, build and launch

The `better-sqlite3` package compiles a native binary for the system it is installed on. **Do not upload `node_modules` from your own computer.** Let the server install dependencies itself.

**Option A: upload already-built files (works on any Node server type)**

1. On your computer, run:
   ```bash
   npm install
   npm run build
   ```
2. In the panel, open **Files** and upload `package.json`, `package-lock.json`, the `dist/` folder and an empty `data/` folder. Then create `.env` as described in step 3.
3. Start the server. Most Node server types run `npm install` automatically on startup. If yours does not, add the packages listed in `dependencies` to the server's **Node packages** variable in the Startup tab.
4. Open **Console**. You should see:
   ```
   [INFO] Database: /home/container/data/bot.sqlite
   [INFO] Bot @your_bot started (support group -100...)
   ```

**Option B: Deploy from GitHub**

1. Use the panel's **Deploy from GitHub** option with `https://github.com/galayder/mudra-hata-tg-bot`, branch `main`. If it offers auto-update, turn it on.
2. Set the main file to `dist/index.js` in the **Startup** tab.
3. Create `.env` as described in step 3, then press **Start**.

You don't need a build step. The `postinstall` script runs `tsc` during `npm install`, which creates `dist/`. TypeScript is listed under `dependencies` so it is installed even when the host skips dev packages. To deploy a change, push to `main` and restart the server, or redeploy if auto-update is off.

### Verifying

1. From a personal Telegram account, open the bot and send `hello`.
2. A topic named `Your Name (@username)` should appear in the support group, with a user card and your message. Your private chat should receive the greeting.
3. Reply inside that topic. The reply should arrive in the bot's private chat.

### Troubleshooting

| Console message | Fix |
|---|---|
| `Missing required environment variable: BOT_TOKEN` | `.env` is missing, not in the root folder, or misnamed. On Windows, watch out for `.env.txt`. |
| `401: Unauthorized` | The token is wrong. Copy it again from BotFather. |
| `is not a supergroup with Topics enabled` | Turn on **Topics** in the group settings. |
| `Bot is not an admin with the "Manage Topics" right` | Make the bot an admin and give it **Manage Topics**. |
| `Cannot access support group ... chat not found` | The bot was not added to the group, or `SUPPORT_GROUP_ID` is wrong (it must start with `-100`). |
| Errors about `better_sqlite3.node` / `invalid ELF header` | `node_modules` was uploaded from another OS. Delete it on the server and let it reinstall. |
| `Conflict: terminated by other getUpdates request` | The same token is running in two places, such as your laptop and the server. Stop one of them. |

### Backups

All state lives in `data/bot.sqlite`, plus the `-wal` and `-shm` files next to it while the bot is running. To back up, stop the server and download the `data/` folder. If this file is lost, users get new topics the next time they write.

## Notes and limits

- Albums are copied one item at a time.
- Message edits and deletions are not synced.
- Telegram rate limits (HTTP 429) are retried automatically by `@grammyjs/auto-retry`.
