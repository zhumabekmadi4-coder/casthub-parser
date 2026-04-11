import { ipcMain, BrowserWindow } from "electron";
import { getDb } from "../db/sqlite";
import { isDuplicate, markProcessed, externalIdHash, cleanOldEntries } from "./dedup.service";
import { OpenAIProvider } from "./ai/openai.provider";
import type { AiProvider, ExtractedMeta } from "./ai/provider.interface";

let provider: AiProvider | null = null;

function sendToRenderer(channel: string, ...args: any[]) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args);
  }
}

function getPrompt(key: string): string {
  const db = getDb();
  const row = db
    .prepare("SELECT system_prompt FROM prompts WHERE key = ?")
    .get(key) as { system_prompt: string } | undefined;
  return row?.system_prompt ?? "";
}

function getSetting(key: string): string {
  const db = getDb();
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? "";
}

function getOrCreateProvider(): AiProvider {
  if (provider) return provider;

  const providerName = getSetting("ai_provider");
  const apiKey = getSetting("ai_api_key");
  const model = getSetting("ai_model");

  if (!apiKey) throw new Error("AI API key not configured");

  // For now only OpenAI, extensible later
  provider = new OpenAIProvider(apiKey, model || "gpt-4o-mini");
  return provider;
}

// Reset provider when settings change
export function resetProvider() {
  provider = null;
}

export interface MessagePayload {
  chatId: number;
  messageId: number;
  text: string;
  date: number;
  senderUserId: number | null;
  forwardInfo: any;
}

export async function processMessage(msg: MessagePayload): Promise<void> {
  const { chatId, messageId, text, date, senderUserId, forwardInfo } = msg;

  if (!text || text.length < 50) return;

  // Build forward origin key
  const forwardOrigin = forwardInfo?.origin
    ? `${forwardInfo.origin.chat_id || ""}:${forwardInfo.origin.message_id || ""}`
    : null;

  // Dedup check
  if (isDuplicate(chatId, messageId, text, forwardOrigin)) {
    sendToRenderer("pipeline:event", {
      type: "skipped",
      reason: "duplicate",
      chatId,
      messageId,
    });
    return;
  }

  const ai = getOrCreateProvider();

  // Step 1: Relevance check
  let classification: "casting" | "technical" | "skip";
  try {
    classification = await ai.checkRelevance(text, getPrompt("relevance_check"));
  } catch (err) {
    markProcessed(chatId, messageId, text, "error", forwardOrigin);
    sendToRenderer("pipeline:event", {
      type: "error",
      step: "relevance",
      error: String(err),
      chatId,
      messageId,
    });
    return;
  }

  if (classification === "skip") {
    markProcessed(chatId, messageId, text, "skip", forwardOrigin);
    sendToRenderer("pipeline:event", {
      type: "skipped",
      reason: "irrelevant",
      chatId,
      messageId,
    });
    return;
  }

  // Step 2: Extract meta (contacts, cities, dates)
  let meta: ExtractedMeta;
  try {
    meta = await ai.extractMeta(text, classification, getPrompt("extract_meta"));
  } catch (err) {
    enqueueFailed(chatId, messageId, text, "ai_failed", `Meta extraction failed: ${err}`);
    markProcessed(chatId, messageId, text, classification, forwardOrigin);
    return;
  }

  // Check contacts — if none, try TDLib username lookup
  const hasContact =
    meta.contacts.telegram || meta.contacts.whatsapp || meta.contacts.phone;

  if (!hasContact && senderUserId) {
    try {
      const { ipcMain } = require("electron");
      // Use tdlib service to get username
      const tdlib = require("./tdlib.service");
      const client = tdlib.getClient();
      if (client) {
        const user = await client.invoke({ _: "getUser", user_id: senderUserId });
        if (user?.usernames?.active_usernames?.length) {
          meta.contacts.telegram = "@" + user.usernames.active_usernames[0];
        }
      }
    } catch {
      // Ignore lookup failure
    }
  }

  // If still no contacts — ignore this announcement
  const finalHasContact =
    meta.contacts.telegram || meta.contacts.whatsapp || meta.contacts.phone;
  if (!finalHasContact) {
    markProcessed(chatId, messageId, text, classification, forwardOrigin);
    sendToRenderer("pipeline:event", {
      type: "skipped",
      reason: "no_contacts",
      chatId,
      messageId,
    });
    return;
  }

  // Step 3: Count roles/vacancies
  let itemNames: string[];
  try {
    itemNames = await ai.countItems(
      meta.cleanedText,
      classification,
      getPrompt("count_items")
    );
  } catch (err) {
    enqueueFailed(chatId, messageId, text, "ai_failed", `Count items failed: ${err}`);
    markProcessed(chatId, messageId, text, classification, forwardOrigin);
    return;
  }

  if (!itemNames.length) {
    itemNames = [classification === "casting" ? "Роль" : "Вакансия"];
  }

  // Step 4: Extract each role/vacancy separately
  const roles: any[] = [];
  const vacancies: any[] = [];

  for (const name of itemNames) {
    try {
      if (classification === "casting") {
        const role = await ai.extractRole(text, name, getPrompt("extract_role"));
        roles.push(role);
      } else {
        const vacancy = await ai.extractVacancy(
          text,
          name,
          getPrompt("extract_vacancy")
        );
        vacancies.push(vacancy);
      }
    } catch (err) {
      console.error(`Failed to extract ${name}:`, err);
      // Continue with other items
    }
  }

  if (roles.length === 0 && vacancies.length === 0) {
    enqueueFailed(chatId, messageId, text, "ai_failed", "No roles/vacancies extracted");
    markProcessed(chatId, messageId, text, classification, forwardOrigin);
    return;
  }

  // Step 5: Assembly
  const defaultDays = parseInt(getSetting("default_expiration_days") || "3");
  let expiresAt = meta.expiresAt;
  if (!expiresAt) {
    const d = new Date(date * 1000 + defaultDays * 24 * 60 * 60 * 1000);
    expiresAt = d.toISOString();
  }

  const parsedData = {
    externalId: externalIdHash(chatId, messageId),
    title: meta.title,
    description: meta.cleanedText.substring(0, 2000),
    type: classification,
    city: meta.cities[0] || undefined,
    cities: meta.cities.length > 1 ? meta.cities : undefined,
    whatsapp: meta.contacts.whatsapp || undefined,
    telegram: meta.contacts.telegram || undefined,
    phone: meta.contacts.phone || undefined,
    expiresAt,
    sourceUrl: `https://t.me/c/${Math.abs(chatId)}/${messageId}`,
    roles: classification === "casting" ? roles : undefined,
    vacancies: classification === "technical" ? vacancies : undefined,
  };

  // Add to queue
  const db = getDb();
  const autoPublish = getSetting("auto_publish") === "true";

  db.prepare(
    `INSERT INTO import_queue (content_hash, raw_text, parsed_data, status)
     VALUES (?, ?, ?, ?)`
  ).run(
    externalIdHash(chatId, messageId),
    text,
    JSON.stringify(parsedData),
    autoPublish ? "pending" : "review"
  );

  markProcessed(chatId, messageId, text, classification, forwardOrigin);

  sendToRenderer("pipeline:event", {
    type: "processed",
    classification,
    title: meta.title,
    rolesCount: roles.length,
    vacanciesCount: vacancies.length,
    status: autoPublish ? "pending" : "review",
    chatId,
    messageId,
  });
}

function enqueueFailed(
  chatId: number,
  messageId: number,
  text: string,
  status: string,
  error: string
) {
  const db = getDb();
  db.prepare(
    `INSERT INTO import_queue (content_hash, raw_text, parsed_data, status, error)
     VALUES (?, ?, ?, ?, ?)`
  ).run(externalIdHash(chatId, messageId), text, "{}", status, error);

  sendToRenderer("pipeline:event", {
    type: "error",
    error,
    chatId,
    messageId,
  });
}

export function registerPipelineHandlers(): void {
  // Process a single message (called from renderer or tdlib service)
  ipcMain.handle("pipeline:process", async (_e, msg: MessagePayload) => {
    try {
      await processMessage(msg);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Reset AI provider (when settings change)
  ipcMain.handle("pipeline:reset-provider", () => {
    resetProvider();
    return true;
  });

  // Clean old dedup entries
  ipcMain.handle("pipeline:clean-dedup", () => {
    const days = parseInt(getSetting("dedup_cache_days") || "7");
    const cleaned = cleanOldEntries(days);
    return { cleaned };
  });
}
