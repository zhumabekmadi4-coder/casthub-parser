import Database from "better-sqlite3";
import path from "path";
import { app } from "electron";

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return db;
}

export function initDb(): void {
  const dbPath = path.join(app.getPath("userData"), "casthub-parser.db");
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  runMigrations();
}

function runMigrations(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS monitored_chats (
      chat_id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      last_processed_message_id INTEGER,
      collect_from_date TEXT,
      added_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS processed_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      forward_origin TEXT,
      classification TEXT,
      processed_at TEXT DEFAULT (datetime('now')),
      UNIQUE(chat_id, message_id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_content_hash
      ON processed_messages(content_hash);

    CREATE TABLE IF NOT EXISTS import_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content_hash TEXT NOT NULL,
      raw_text TEXT NOT NULL,
      parsed_data TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      casthub_project_id TEXT,
      error TEXT,
      retry_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      delivered_at TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS prompts (
      key TEXT PRIMARY KEY,
      system_prompt TEXT NOT NULL,
      model_override TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Insert default settings if not exist
  const defaults: [string, string][] = [
    ["casthub_api_url", "https://app.casthub.kz"],
    ["casthub_api_key", ""],
    ["ai_provider", "openai"],
    ["ai_api_key", ""],
    ["ai_model", "gpt-4o-mini"],
    ["auto_publish", "false"],
    ["default_expiration_days", "3"],
    ["dedup_cache_days", "7"],
  ];

  const insertSetting = db.prepare(
    "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)"
  );
  for (const [key, value] of defaults) {
    insertSetting.run(key, value);
  }

  // Insert default prompts
  const defaultPrompts: [string, string][] = [
    [
      "relevance_check",
      `You are a classifier for a film industry job board in Kazakhstan.
Determine if the message is:
- "casting" — looking for actors (any roles, extras, models)
- "technical" — looking for crew (cameraman, editor, sound engineer, lighting, makeup, etc.)
- "skip" — not a job/casting announcement

Reply with ONLY one word: casting, technical, or skip.`,
    ],
    [
      "extract_meta",
      `Extract metadata from this job/casting announcement. Return JSON:
{
  "contacts": { "telegram": "@handle or null", "whatsapp": "+phone or null", "phone": "+phone or null" },
  "cities": ["city names in Russian"],
  "expiresAt": "YYYY-MM-DD or null (if specific date mentioned)",
  "cleanedText": "original text with contacts/links removed",
  "title": "short descriptive title in Russian"
}
Only return valid JSON, nothing else.`,
    ],
    [
      "count_items",
      `List all distinct roles (for casting) or job positions (for technical work) mentioned in this announcement.
Return a JSON array of short names, e.g.: ["Жена героя", "Сын", "Официант"]
Only return the JSON array, nothing else.`,
    ],
    [
      "extract_role",
      `Extract details for the casting role "{roleName}" from this announcement. Return JSON:
{
  "name": "role name",
  "gender": "male" | "female" | "other" | "any",
  "ageMin": number or null,
  "ageMax": number or null,
  "type": "lead" | "episodic" | "background",
  "description": "role description or null",
  "payment": "payment info or null"
}
IMPORTANT: gender is REQUIRED. Infer from context if not explicit (e.g. "жена"=female, "сын"=male, "официант"=any).
Only return valid JSON.`,
    ],
    [
      "extract_vacancy",
      `Extract details for the job position "{vacancyName}" from this announcement. Return JSON:
{
  "professionName": "profession name in Russian",
  "payment": "payment info or null",
  "schedule": "schedule info or null",
  "requirements": "requirements or null"
}
Only return valid JSON.`,
    ],
  ];

  const insertPrompt = db.prepare(
    "INSERT OR IGNORE INTO prompts (key, system_prompt) VALUES (?, ?)"
  );
  for (const [key, prompt] of defaultPrompts) {
    insertPrompt.run(key, prompt);
  }
}
