import { ipcMain, BrowserWindow } from "electron";
import * as tdl from "tdl";
import * as prebuilt from "prebuilt-tdlib";
import path from "path";
import { app } from "electron";
import { dbAll, dbGet, dbRun } from "../db/sqlite";
import { processMessage } from "./pipeline.service";

let client: ReturnType<typeof tdl.createClient> | null = null;
let authState: string = "idle";
let monitoredChatIds: Set<number> = new Set();
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
  return monitoredChatIds;
}

export function registerTdlibHandlers(): void {
  // Auth
  ipcMain.handle("tdlib:get-auth-state", () => authState);

  ipcMain.handle("tdlib:connect", async (_e, apiId: number, apiHash: string) => {
    if (client) return { ok: true, state: authState };

    try {
      tdl.configure({ tdjson: prebuilt.getTdjson() });

      client = tdl.createClient({
        apiId,
        apiHash,
        databaseDirectory: path.join(app.getPath("userData"), "tdlib_db"),
        filesDirectory: path.join(app.getPath("userData"), "tdlib_files"),
      });

      client.on("error", (err) => {
        console.error("TDLib error:", err);
      });

      // Start login flow — don't await, it blocks until auth complete
      client.login(() => ({
        getPhoneNumber: async (retry) => {
          authState = "waitPhoneNumber";
          sendToRenderer("tdlib:auth-state", authState);
          return new Promise((resolve) => {
            ipcMain.once("tdlib:send-phone", (_e, phone: string) => {
              resolve(phone);
            });
          });
        },
        getAuthCode: async (retry) => {
          authState = "waitCode";
          sendToRenderer("tdlib:auth-state", authState);
          return new Promise((resolve) => {
            ipcMain.once("tdlib:send-code", (_e, code: string) => {
              resolve(code);
            });
          });
        },
        getPassword: async (hint, retry) => {
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
      })).then(() => {
        authState = "ready";
        sendToRenderer("tdlib:auth-state", authState);
        loadMonitoredChats();
        startMessageListener();
      }).catch((err) => {
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

  ipcMain.handle("tdlib:send-phone", (_e, phone: string) => {
    // Handled by ipcMain.once in login flow
  });

  ipcMain.handle("tdlib:send-code", (_e, code: string) => {
    // Handled by ipcMain.once in login flow
  });

  ipcMain.handle("tdlib:send-password", (_e, password: string) => {
    // Handled by ipcMain.once in login flow
  });

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
        // Only show groups and channels (not private chats)
        if (
          chat.type._ === "chatTypeSupergroup" ||
          chat.type._ === "chatTypeBasicGroup"
        ) {
          chats.push({
            id: chat.id,
            title: chat.title,
            type: chat.type._,
            memberCount: chat.type._ === "chatTypeSupergroup"
              ? (chat as any).type?.member_count
              : null,
          });
        }
      } catch {
        // Skip inaccessible chats
      }
    }
    return chats;
  });

  ipcMain.handle("tdlib:add-chat", (_e, chatId: number, title: string) => {
    dbRun(
      "INSERT OR IGNORE INTO monitored_chats (chat_id, title) VALUES (?, ?)",
      [chatId, title]
    );
    monitoredChatIds.add(chatId);
    return true;
  });

  ipcMain.handle("tdlib:remove-chat", (_e, chatId: number) => {
    dbRun("DELETE FROM monitored_chats WHERE chat_id = ?", [chatId]);
    monitoredChatIds.delete(chatId);
    return true;
  });

  ipcMain.handle("tdlib:get-monitored-chats", () => {
    return dbAll("SELECT * FROM monitored_chats ORDER BY added_at DESC");
  });

  ipcMain.handle(
    "tdlib:set-collect-from",
    (_e, chatId: number, date: string) => {
      dbRun(
        "UPDATE monitored_chats SET collect_from_date = ? WHERE chat_id = ?",
        [date, chatId]
      );
      return true;
    }
  );

  // History sync — fetches messages from newest to oldest, stops at collect_from_date
  ipcMain.handle("tdlib:sync-history", async (_e, chatId: number) => {
    if (!client || authState !== "ready") return { synced: 0 };

    const chat = dbGet("SELECT * FROM monitored_chats WHERE chat_id = ?", [chatId]);
    if (!chat) return { synced: 0 };

    let synced = 0;
    let fromMsgId = 0; // 0 = start from newest message
    let reachedDateLimit = false;

    // Fetch in batches of 50, up to 1000 messages total
    for (let i = 0; i < 20 && !reachedDateLimit; i++) {
      const history = await client.invoke({
        _: "getChatHistory",
        chat_id: chatId,
        from_message_id: fromMsgId,
        offset: 0,
        limit: 50,
        only_local: false,
      });

      if (!history.messages || history.messages.length === 0) break;

      for (const msg of history.messages) {
        if (!msg) continue;

        // Check collect_from_date — stop if message is older
        if (chat.collect_from_date) {
          const msgDate = new Date(msg.date * 1000);
          const fromDate = new Date(chat.collect_from_date);
          if (msgDate < fromDate) {
            reachedDateLimit = true;
            break;
          }
        }

        const text = extractText(msg);
        if (text && text.length >= 50) {
          try {
            await processMessage({
              chatId,
              messageId: msg.id,
              text,
              date: msg.date,
              senderUserId: msg.sender_id?.user_id || null,
              forwardInfo: msg.forward_info || null,
            });
            synced++;
          } catch (err) {
            console.error("Pipeline error during sync:", err);
          }
        }

        fromMsgId = msg.id;
      }
    }

    // Update last_processed_message_id to the newest message
    if (synced > 0) {
      dbRun(
        "UPDATE monitored_chats SET last_processed_message_id = ? WHERE chat_id = ?",
        [fromMsgId, chatId]
      );
    }

    return { synced };
  });

  // Get sender username
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

function loadMonitoredChats() {
  const chats = dbAll("SELECT chat_id FROM monitored_chats");
  monitoredChatIds = new Set(chats.map((c: any) => c.chat_id));
}

function startMessageListener() {
  if (!client || messageHandler) return;

  messageHandler = (update: any) => {
    if (update._ === "updateNewMessage") {
      const msg = update.message;
      if (!msg || !monitoredChatIds.has(msg.chat_id)) return;

      const text = extractText(msg);
      if (!text || text.length < 50) return; // Pre-filter: too short

      // Update last_processed_message_id
      dbRun(
        `UPDATE monitored_chats
         SET last_processed_message_id = MAX(COALESCE(last_processed_message_id, 0), ?)
         WHERE chat_id = ?`,
        [msg.id, msg.chat_id]
      );

      // Process through AI pipeline
      processMessage({
        chatId: msg.chat_id,
        messageId: msg.id,
        text,
        date: msg.date,
        senderUserId: msg.sender_id?.user_id || null,
        forwardInfo: msg.forward_info || null,
      }).catch((err) => console.error("Pipeline error:", err));
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

function extractText(msg: any): string | null {
  const content = msg.content;
  if (!content) return null;

  if (content._ === "messageText") {
    return content.text?.text || null;
  }
  // Photo/video with caption
  if (content.caption?.text) {
    return content.caption.text;
  }
  return null;
}
