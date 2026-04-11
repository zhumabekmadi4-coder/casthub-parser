import initSqlJs, { Database as SqlJsDatabase } from "sql.js";
import path from "path";
import fs from "fs";
import { app } from "electron";

let db: SqlJsDatabase;
let dbPath: string;

export function getDb(): SqlJsDatabase {
  if (!db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return db;
}

// Save database to disk
function saveDb(): void {
  if (!db || !dbPath) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

// Auto-save every 5 seconds
let saveInterval: ReturnType<typeof setInterval> | null = null;

export async function initDb(): Promise<void> {
  const SQL = await initSqlJs();

  dbPath = path.join(app.getPath("userData"), "casthub-parser.db");

  // Load existing database if it exists
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  runMigrations();
  saveDb();

  // Auto-save periodically
  saveInterval = setInterval(saveDb, 5000);

  // Save on app quit
  app.on("before-quit", () => {
    saveDb();
    if (saveInterval) clearInterval(saveInterval);
  });
}

// Helper to run a query and get results as objects
export function dbAll(sql: string, params: any[] = []): any[] {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const results: any[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

export function dbGet(sql: string, params: any[] = []): any | undefined {
  const results = dbAll(sql, params);
  return results[0];
}

export function dbRun(sql: string, params: any[] = []): void {
  db.run(sql, params);
  saveDb();
}

function runMigrations(): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS monitored_chats (
      chat_id INTEGER PRIMARY KEY,
      title TEXT NOT NULL,
      last_processed_message_id INTEGER,
      collect_from_date TEXT,
      added_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS processed_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      message_id INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      forward_origin TEXT,
      classification TEXT,
      processed_at TEXT DEFAULT (datetime('now')),
      UNIQUE(chat_id, message_id)
    )
  `);

  db.run(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_content_hash
      ON processed_messages(content_hash)
  `);

  db.run(`
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
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS prompts (
      key TEXT PRIMARY KEY,
      system_prompt TEXT NOT NULL,
      model_override TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
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

  for (const [key, value] of defaults) {
    db.run(
      "INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)",
      [key, value]
    );
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

  for (const [key, prompt] of defaultPrompts) {
    db.run(
      "INSERT OR IGNORE INTO prompts (key, system_prompt) VALUES (?, ?)",
      [key, prompt]
    );
  }
}
