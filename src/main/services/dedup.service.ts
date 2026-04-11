import { createHash } from "crypto";
import { getDb } from "../db/sqlite";

// Normalize text for content-based dedup
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")        // Remove URLs
    .replace(/@\w+/g, "")                   // Remove @mentions
    .replace(/\+?\d[\d\s()-]{7,}/g, "")     // Remove phone numbers
    .replace(/[\u{1F600}-\u{1F6FF}]/gu, "") // Remove emoji
    .replace(/\s+/g, " ")                   // Collapse whitespace
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

// Returns true if duplicate (already processed)
export function isDuplicate(
  chatId: number,
  messageId: number,
  text: string,
  forwardOrigin?: string | null
): boolean {
  const db = getDb();

  // Check by chat_id + message_id (exact message)
  const byMsg = db
    .prepare(
      "SELECT id FROM processed_messages WHERE chat_id = ? AND message_id = ?"
    )
    .get(chatId, messageId);
  if (byMsg) return true;

  // Check by forward origin
  if (forwardOrigin) {
    const byForward = db
      .prepare("SELECT id FROM processed_messages WHERE forward_origin = ?")
      .get(forwardOrigin);
    if (byForward) return true;
  }

  // Check by content hash (cross-chat dedup)
  const hash = contentHash(text);
  const byHash = db
    .prepare("SELECT id FROM processed_messages WHERE content_hash = ?")
    .get(hash);
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
  const db = getDb();
  const hash = contentHash(text);

  db.prepare(
    `INSERT OR IGNORE INTO processed_messages
     (chat_id, message_id, content_hash, forward_origin, classification)
     VALUES (?, ?, ?, ?, ?)`
  ).run(chatId, messageId, hash, forwardOrigin || null, classification);
}

// Clean old dedup entries
export function cleanOldEntries(days: number): number {
  const db = getDb();
  const result = db
    .prepare(
      `DELETE FROM processed_messages
       WHERE processed_at < datetime('now', '-' || ? || ' days')`
    )
    .run(days);
  return result.changes;
}
