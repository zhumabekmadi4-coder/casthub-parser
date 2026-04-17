import { createHash } from "crypto";
import { dbGet, dbRun } from "../db/sqlite";

// Comprehensive emoji + symbol removal covering all Unicode emoji blocks:
// Emoticons, Dingbats, Symbols, Transport, Misc, Flags, Modifiers,
// Variation selectors, ZWJ sequences, keycap sequences
const EMOJI_REGEX =
  /[\u{200D}\u{FE0F}\u{20E3}\u{2000}-\u{206F}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B50}\u{2B55}\u{2934}-\u{2935}\u{3030}\u{303D}\u{3297}\u{3299}\u{1F000}-\u{1FAFF}\u{E0020}-\u{E007F}]/gu;

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/@\w+/g, "")
    .replace(/\+?\d[\d\s()-]{7,}/g, "")
    .replace(EMOJI_REGEX, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function contentHash(text: string): string {
  const normalized = normalizeText(text);
  return createHash("sha256").update(normalized).digest("hex");
}

export function externalIdHash(chatId: number, messageId: number): string {
  return createHash("sha256")
    .update(`${chatId}:${messageId}`)
    .digest("hex");
}

export function isDuplicate(
  chatId: number,
  messageId: number,
  text: string,
  forwardOrigin?: string | null
): boolean {
  const byMsg = dbGet(
    "SELECT id FROM processed_messages WHERE chat_id = ? AND message_id = ?",
    [chatId, messageId]
  );
  if (byMsg) return true;

  if (forwardOrigin) {
    const byForward = dbGet(
      "SELECT id FROM processed_messages WHERE forward_origin = ?",
      [forwardOrigin]
    );
    if (byForward) return true;
  }

  const hash = contentHash(text);
  const byHash = dbGet(
    "SELECT id FROM processed_messages WHERE content_hash = ?",
    [hash]
  );
  if (byHash) return true;

  return false;
}

export function markProcessed(
  chatId: number,
  messageId: number,
  text: string,
  classification: string,
  forwardOrigin?: string | null
): void {
  const hash = contentHash(text);
  dbRun(
    `INSERT OR IGNORE INTO processed_messages
     (chat_id, message_id, content_hash, forward_origin, classification)
     VALUES (?, ?, ?, ?, ?)`,
    [chatId, messageId, hash, forwardOrigin || null, classification]
  );
}

export function removeProcessed(chatId: number, messageId: number): boolean {
  const existing = dbGet(
    "SELECT id FROM processed_messages WHERE chat_id = ? AND message_id = ?",
    [chatId, messageId]
  );
  if (!existing) return false;
  dbRun("DELETE FROM processed_messages WHERE chat_id = ? AND message_id = ?", [chatId, messageId]);
  return true;
}

export function cleanOldEntries(days: number): number {
  const { getDb } = require("../db/sqlite");
  const db = getDb();
  const before = new Date(Date.now() - days * 86400000).toISOString();
  db.run("DELETE FROM processed_messages WHERE processed_at < ?", [before]);
  return db.getRowsModified();
}
