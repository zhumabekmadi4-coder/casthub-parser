import { ipcMain, BrowserWindow } from "electron";
import * as tdl from "tdl";
import * as prebuilt from "prebuilt-tdlib";
import path from "path";
import { app } from "electron";
import { dbAll, dbGet, dbRun } from "../db/sqlite";
import { processMessage, logEvent } from "./pipeline.service";
import { runWithConcurrency } from "./concurrency";

let client: ReturnType<typeof tdl.createClient> | null = null;
let authState: string = "idle";

interface MonitoredKey {
  chatId: number;
  threadId: number | null;
}

let monitoredChats: Map<number, MonitoredKey[]> = new Map();
let messageHandler: ((update: any) => void) | null = null;

function sendToRenderer(channel: string, ...args: any[]) {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    win.webContents.send(channel, ...args);
  }
}

export function getClient() {
  return client;
}

export function getMonitoredChatIds() {
  return new Set(monitoredChats.keys());
}

function isMonitoredMessage(chatId: number, threadId: number | null): boolean {
  const subs = monitoredChats.get(chatId);
  if (!subs) return false;
  // Whole-chat subscription matches every message
  if (subs.some((s) => s.threadId === null)) return true;
  if (threadId === null) return false;
  return subs.some((s) => s.threadId === threadId);
}

export function registerTdlibHandlers(): void {
  ipcMain.handle("tdlib:get-auth-state", () => authState);

  ipcMain.handle("tdlib:connect", async (_e, apiId: number, apiHash: string) => {
    if (client) return { ok: true, state: authState };

    try {
      let tdjsonPath = prebuilt.getTdjson();
      if (app.isPackaged) {
        // require.resolve returns a path inside app.asar, but native .dll
        // lives in app.asar.unpacked (see asarUnpack in package.json).
        tdjsonPath = tdjsonPath.replace(
          `${path.sep}app.asar${path.sep}`,
          `${path.sep}app.asar.unpacked${path.sep}`
        );
      }
      tdl.configure({ tdjson: tdjsonPath });

      client = tdl.createClient({
        apiId,
        apiHash,
        databaseDirectory: path.join(app.getPath("userData"), "tdlib_db"),
        filesDirectory: path.join(app.getPath("userData"), "tdlib_files"),
      });

      client.on("error", (err) => {
        console.error("TDLib error:", err);
      });

      client
        .login(() => ({
          getPhoneNumber: async (_retry) => {
            authState = "waitPhoneNumber";
            sendToRenderer("tdlib:auth-state", authState);
            return new Promise((resolve) => {
              ipcMain.once("tdlib:send-phone", (_e, phone: string) => {
                resolve(phone);
              });
            });
          },
          getAuthCode: async (_retry) => {
            authState = "waitCode";
            sendToRenderer("tdlib:auth-state", authState);
            return new Promise((resolve) => {
              ipcMain.once("tdlib:send-code", (_e, code: string) => {
                resolve(code);
              });
            });
          },
          getPassword: async (hint, _retry) => {
            authState = "waitPassword";
            sendToRenderer("tdlib:auth-state", authState, hint);
            return new Promise((resolve) => {
              ipcMain.once("tdlib:send-password", (_e, password: string) => {
                resolve(password);
              });
            });
          },
          getName: async () => {
            return { firstName: "CastHub", lastName: "Parser" };
          },
        }))
        .then(() => {
          authState = "ready";
          sendToRenderer("tdlib:auth-state", authState);
          loadMonitoredChats();
          startMessageListener();
        })
        .catch((err) => {
          console.error("TDLib login error:", err);
          authState = "error";
          sendToRenderer("tdlib:auth-state", authState, String(err));
        });

      return { ok: true, state: "connecting" };
    } catch (err) {
      console.error("TDLib connect error:", err);
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("tdlib:send-phone", (_e, _phone: string) => {});
  ipcMain.handle("tdlib:send-code", (_e, _code: string) => {});
  ipcMain.handle("tdlib:send-password", (_e, _password: string) => {});

  ipcMain.handle("tdlib:disconnect", async () => {
    if (client) {
      stopMessageListener();
      await client.close();
      client = null;
      authState = "idle";
      sendToRenderer("tdlib:auth-state", authState);
    }
    return true;
  });

  // Chat management
  ipcMain.handle("tdlib:get-chats", async () => {
    if (!client || authState !== "ready") return [];

    const result = await client.invoke({
      _: "getChats",
      chat_list: { _: "chatListMain" },
      limit: 200,
    });

    const chats: any[] = [];
    for (const chatId of result.chat_ids) {
      try {
        const chat = await client.invoke({ _: "getChat", chat_id: chatId });
        if (
          chat.type._ === "chatTypeSupergroup" ||
          chat.type._ === "chatTypeBasicGroup"
        ) {
          // Detect forum-enabled supergroups via the supergroup full info
          let isForum = false;
          if (chat.type._ === "chatTypeSupergroup") {
            try {
              const sg = await client.invoke({
                _: "getSupergroup",
                supergroup_id: (chat.type as any).supergroup_id,
              });
              isForum = !!sg.is_forum;
            } catch {
              // Not critical — assume not a forum
            }
          }
          chats.push({
            id: chat.id,
            title: chat.title,
            type: chat.type._,
            isForum,
          });
        }
      } catch {
        // Skip inaccessible chats
      }
    }
    return chats;
  });

  ipcMain.handle("tdlib:get-forum-topics", async (_e, chatId: number) => {
    if (!client || authState !== "ready") return [];
    try {
      const result: any = await client.invoke({
        _: "getForumTopics",
        chat_id: chatId,
        query: "",
        offset_date: 0,
        offset_message_id: 0,
        limit: 100,
      } as any);
      return (result.topics || []).map((t: any) => ({
        threadId: t.message_thread_id,
        title: t.info?.name || "(без названия)",
      }));
    } catch (err) {
      console.error("getForumTopics error:", err);
      return [];
    }
  });

  ipcMain.handle(
    "tdlib:add-chat",
    (
      _e,
      chatId: number,
      title: string,
      threadId: number | null = null,
      threadTitle: string | null = null
    ) => {
      // Avoid duplicates: same (chat_id, thread_id) pair
      const existing = dbGet(
        `SELECT id FROM monitored_chats
         WHERE chat_id = ? AND COALESCE(thread_id, 0) = COALESCE(?, 0)`,
        [chatId, threadId]
      );
      if (existing) return false;
      dbRun(
        `INSERT INTO monitored_chats (chat_id, title, thread_id, thread_title)
         VALUES (?, ?, ?, ?)`,
        [chatId, title, threadId, threadTitle]
      );
      registerSubscription(chatId, threadId);
      return true;
    }
  );

  ipcMain.handle("tdlib:remove-chat", (_e, id: number) => {
    const row = dbGet("SELECT chat_id, thread_id FROM monitored_chats WHERE id = ?", [id]);
    dbRun("DELETE FROM monitored_chats WHERE id = ?", [id]);
    if (row) {
      const subs = monitoredChats.get(row.chat_id);
      if (subs) {
        const filtered = subs.filter((s) => s.threadId !== (row.thread_id ?? null));
        if (filtered.length) monitoredChats.set(row.chat_id, filtered);
        else monitoredChats.delete(row.chat_id);
      }
    }
    return true;
  });

  ipcMain.handle("tdlib:get-monitored-chats", () => {
    return dbAll("SELECT * FROM monitored_chats ORDER BY added_at DESC");
  });

  ipcMain.handle("tdlib:get-chat-stats", (_e, chatId: number) => {
    const rows = dbAll(
      "SELECT stat_type, count FROM chat_stats WHERE chat_id = ?",
      [chatId]
    );
    const result: Record<string, number> = {};
    for (const row of rows as any[]) {
      result[row.stat_type] = row.count;
    }
    return result;
  });

  ipcMain.handle("tdlib:get-all-chat-stats", () => {
    const rows = dbAll("SELECT chat_id, stat_type, count FROM chat_stats");
    const result: Record<number, Record<string, number>> = {};
    for (const row of rows as any[]) {
      if (!result[row.chat_id]) result[row.chat_id] = {};
      result[row.chat_id][row.stat_type] = row.count;
    }
    return result;
  });

  ipcMain.handle(
    "tdlib:set-collect-from",
    (_e, id: number, date: string) => {
      dbRun("UPDATE monitored_chats SET collect_from_date = ? WHERE id = ?", [date, id]);
      return true;
    }
  );

  // History sync — fetches messages from newest to oldest, stops at collect_from_date.
  // Within each fetched page, messages are processed concurrently (HISTORY_CONCURRENCY)
  // because the pipeline is mostly waiting on OpenAI. The global semaphore in
  // openai.provider.ts caps total in-flight AI calls so we don't overrun rate limits.
  ipcMain.handle("tdlib:sync-history", async (_e, id: number) => {
    if (!client || authState !== "ready") return { synced: 0 };

    const chat = dbGet("SELECT * FROM monitored_chats WHERE id = ?", [id]);
    if (!chat) return { synced: 0 };

    const HISTORY_CONCURRENCY = 5;
    let synced = 0;
    let fromMsgId = 0;
    let reachedDateLimit = false;

    for (let i = 0; i < 20 && !reachedDateLimit; i++) {
      let history: any;
      if (chat.thread_id) {
        history = await client.invoke({
          _: "getMessageThreadHistory",
          chat_id: chat.chat_id,
          message_id: chat.thread_id,
          from_message_id: fromMsgId,
          offset: 0,
          limit: 50,
        });
      } else {
        history = await client.invoke({
          _: "getChatHistory",
          chat_id: chat.chat_id,
          from_message_id: fromMsgId,
          offset: 0,
          limit: 50,
          only_local: false,
        });
      }

      if (!history.messages || history.messages.length === 0) break;

      const fromDate = chat.collect_from_date ? new Date(chat.collect_from_date) : null;
      const tasks: Array<() => Promise<void>> = [];

      for (const msg of history.messages) {
        if (!msg) continue;

        if (fromDate && new Date(msg.date * 1000) < fromDate) {
          reachedDateLimit = true;
          break;
        }

        const { text, photoFileId } = extractContent(msg);
        fromMsgId = msg.id;

        if ((text && text.length >= 20) || photoFileId) {
          tasks.push(async () => {
            let imagePath: string | null = null;
            if (photoFileId && client) {
              try {
                const file = await client.invoke({
                  _: "downloadFile",
                  file_id: photoFileId,
                  priority: 1,
                  synchronous: true,
                });
                if (file?.local?.path) {
                  imagePath = file.local.path;
                }
              } catch {
                // Photo download failed — proceed with text only
              }
            }

            // Skip if no usable text and photo download failed
            if ((!text || text.length < 20) && !imagePath) return;

            await processMessage({
              chatId: chat.chat_id,
              messageId: msg.id,
              threadId: msg.message_thread_id ?? null,
              text: text || "",
              date: msg.date,
              senderUserId: msg.sender_id?.user_id || null,
              forwardInfo: msg.forward_info || null,
              imagePath,
            });
          });
        }
      }

      const results = await runWithConcurrency(tasks, HISTORY_CONCURRENCY);
      for (const r of results) {
        if (r.status === "fulfilled") synced++;
        else console.error("Pipeline error during sync:", r.reason);
      }
    }

    if (synced > 0) {
      dbRun(
        "UPDATE monitored_chats SET last_processed_message_id = ? WHERE id = ?",
        [fromMsgId, id]
      );
    }

    return { synced };
  });

  ipcMain.handle("tdlib:block-sender", (_e, userId: number, username?: string, reason?: string) => {
    dbRun(
      "INSERT OR IGNORE INTO blocked_senders (user_id, username, reason) VALUES (?, ?, ?)",
      [userId, username || null, reason || null]
    );
    return true;
  });

  ipcMain.handle("tdlib:unblock-sender", (_e, userId: number) => {
    dbRun("DELETE FROM blocked_senders WHERE user_id = ?", [userId]);
    return true;
  });

  ipcMain.handle("tdlib:get-blocked-senders", () => {
    return dbAll("SELECT * FROM blocked_senders ORDER BY blocked_at DESC");
  });

  ipcMain.handle("tdlib:get-username", async (_e, userId: number) => {
    if (!client) return null;
    try {
      const user = await client.invoke({ _: "getUser", user_id: userId });
      if (user.usernames?.active_usernames?.length) {
        return "@" + user.usernames.active_usernames[0];
      }
      return null;
    } catch {
      return null;
    }
  });
}

function registerSubscription(chatId: number, threadId: number | null) {
  const subs = monitoredChats.get(chatId) || [];
  if (!subs.some((s) => s.threadId === threadId)) {
    subs.push({ chatId, threadId });
  }
  monitoredChats.set(chatId, subs);
}

function loadMonitoredChats() {
  const rows = dbAll("SELECT chat_id, thread_id FROM monitored_chats");
  monitoredChats = new Map();
  for (const r of rows as any[]) {
    registerSubscription(r.chat_id, r.thread_id ?? null);
  }
}

function startMessageListener() {
  if (!client || messageHandler) return;

  messageHandler = async (update: any) => {
    if (update._ === "updateNewMessage") {
      const msg = update.message;
      if (!msg) return;
      const threadId = msg.message_thread_id ?? null;
      if (!isMonitoredMessage(msg.chat_id, threadId)) return;

      const senderUserId = msg.sender_id?.user_id || null;
      if (senderUserId) {
        const blocked = dbGet("SELECT id FROM blocked_senders WHERE user_id = ?", [senderUserId]);
        if (blocked) {
          logEvent({ type: "skipped", reason: "blocked_sender", chatId: msg.chat_id, messageId: msg.id });
          return;
        }
      }

      const { text, photoFileId } = extractContent(msg);
      logEvent({
        type: "incoming",
        chatId: msg.chat_id,
        messageId: msg.id,
        threadId,
        textLength: text?.length ?? 0,
      });

      let imagePath: string | null = null;
      if (photoFileId && client) {
        try {
          const file = await client.invoke({
            _: "downloadFile",
            file_id: photoFileId,
            priority: 1,
            synchronous: true,
          });
          if (file?.local?.path) {
            imagePath = file.local.path;
          }
        } catch {
          // Photo download failed — proceed with text only
        }
      }

      if ((!text || text.length < 20) && !imagePath) {
        console.log(`[TDLib] Skipped: too short and no image`);
        return;
      }

      // Update last_processed_message_id for the matching subscription(s)
      dbRun(
        `UPDATE monitored_chats
         SET last_processed_message_id = MAX(COALESCE(last_processed_message_id, 0), ?)
         WHERE chat_id = ?
           AND (thread_id IS NULL OR thread_id = ?)`,
        [msg.id, msg.chat_id, threadId ?? 0]
      );

      processMessage({
        chatId: msg.chat_id,
        messageId: msg.id,
        threadId,
        text: text || "",
        date: msg.date,
        senderUserId: msg.sender_id?.user_id || null,
        forwardInfo: msg.forward_info || null,
        imagePath,
      }).catch((err) => console.error("Pipeline error:", err));
    }

    if (update._ === "updateMessageContent") {
      const chatId = update.chat_id;
      const messageId = update.message_id;

      if (!monitoredChats.has(chatId)) return;

      const { removeProcessed } = require("./dedup.service");
      const wasProcessed = removeProcessed(chatId, messageId);
      if (!wasProcessed) return;

      try {
        const msg = await client!.invoke({ _: "getMessage", chat_id: chatId, message_id: messageId });
        if (!msg) return;

        const threadId = msg.message_thread_id ?? null;
        if (!isMonitoredMessage(chatId, threadId)) return;

        const { text, photoFileId } = extractContent(msg);
        if ((!text || text.length < 20) && !photoFileId) return;

        let imagePath: string | null = null;
        if (photoFileId && client) {
          try {
            const file = await client.invoke({ _: "downloadFile", file_id: photoFileId, priority: 1, synchronous: true });
            if (file?.local?.path) imagePath = file.local.path;
          } catch {}
        }

        logEvent({ type: "incoming", chatId, messageId, threadId, textLength: text?.length ?? 0, edited: true });

        const { externalIdHash } = require("./dedup.service");
        dbRun(
          "DELETE FROM import_queue WHERE content_hash = ? AND status IN ('pending', 'review', 'ai_failed')",
          [externalIdHash(chatId, messageId)]
        );

        processMessage({
          chatId,
          messageId: msg.id,
          threadId,
          text: text || "",
          date: msg.date,
          senderUserId: msg.sender_id?.user_id || null,
          forwardInfo: msg.forward_info || null,
          imagePath,
        }).catch((err) => console.error("Pipeline error (edit):", err));
      } catch (err) {
        console.error("Failed to handle message edit:", err);
      }
    }
  };

  client.on("update", messageHandler);
}

function stopMessageListener() {
  if (client && messageHandler) {
    client.off("update", messageHandler);
    messageHandler = null;
  }
}

interface ExtractedContent {
  text: string | null;
  photoFileId: number | null;
}

function extractContent(msg: any): ExtractedContent {
  const content = msg.content;
  if (!content) return { text: null, photoFileId: null };

  let text: string | null = null;
  let photoFileId: number | null = null;

  if (content._ === "messageText") {
    text = content.text?.text || null;
  } else if (content._ === "messagePhoto") {
    text = content.caption?.text || null;
    const sizes = content.photo?.sizes;
    if (sizes?.length) {
      const largest = sizes[sizes.length - 1];
      photoFileId = largest.photo?.id ?? null;
    }
  } else if (content.caption?.text) {
    text = content.caption.text;
  }

  return { text, photoFileId };
}
