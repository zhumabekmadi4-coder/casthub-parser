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
  "expiresAt": "YYYY-MM-DD or null",
  "cleanedText": "original text with contacts/links/phone numbers removed",
  "title": "short descriptive title in Russian"
}

IMPORTANT rules for expiresAt:
- If shooting/event dates are mentioned (e.g. "28-29 апреля и 1 мая"), use the LAST date ("2026-05-01")
- If a deadline is mentioned (e.g. "до 15 апреля"), use that date
- If relative time is used (e.g. "завтра", "в эту субботу"), resolve to an absolute date based on today's date provided in the Type line
- If no dates at all — set null (the system will add default expiration)
- Always use the year from the current context

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

CRITICAL RULES:
1. GENDER is REQUIRED. Infer from context: "девушка/жена/мама"=female, "парень/сын/муж"=male, "официант"=any.
2. TYPE — determine from the announcement structure:
   - "lead" ONLY if explicitly labeled as "главная роль" or "main role"
   - "episodic" for "второстепенная роль", supporting roles, or roles not marked as main
   - "background" for "массовка", "эпизод без слов", crowd scenes
3. AGE — use the EXACT numbers written for THIS specific role. Do NOT copy age from other roles.
4. PAYMENT — if payment is explicitly mentioned for this role, use it. If not mentioned or unclear, write "Договорная". Never return null for payment.
5. DESCRIPTION — if no description found, return empty string "". Never return null for description.

Only return valid JSON.`,
    ],
    [
      "extract_vacancy",
      `Extract details for the job position "{vacancyName}" from this announcement. Return JSON:
{
  "professionName": "profession name in Russian",
  "payment": "payment info or Договорная if not specified",
  "schedule": "schedule info or empty string if not specified",
  "requirements": "requirements or empty string if not specified"
}
Never return null for any field. Use empty string "" if information is not found. For payment use "Договорная" if not specified.
Only return valid JSON.`,
    ],
  ];

  // Use INSERT OR REPLACE to update prompts on schema changes
  for (const [key, prompt] of defaultPrompts) {
    db.run(
      "INSERT OR REPLACE INTO prompts (key, system_prompt, updated_at) VALUES (?, ?, datetime('now'))",
      [key, prompt]
    );
  }
}
