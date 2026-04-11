import { ipcMain } from "electron";
import { getDb } from "../db/sqlite";

export function registerSettingsHandlers(): void {
  ipcMain.handle("settings:get-all", () => {
    const db = getDb();
    const rows = db.prepare("SELECT key, value FROM settings").all() as {
      key: string;
      value: string;
    }[];
    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    return settings;
  });

  ipcMain.handle("settings:get", (_e, key: string) => {
    const db = getDb();
    const row = db
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get(key) as { value: string } | undefined;
    return row?.value ?? null;
  });

  ipcMain.handle("settings:set", (_e, key: string, value: string) => {
    const db = getDb();
    db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?"
    ).run(key, value, value);
    return true;
  });

  // Prompts
  ipcMain.handle("prompts:get-all", () => {
    const db = getDb();
    return db
      .prepare("SELECT key, system_prompt, model_override, updated_at FROM prompts")
      .all();
  });

  ipcMain.handle(
    "prompts:set",
    (_e, key: string, systemPrompt: string, modelOverride?: string) => {
      const db = getDb();
      db.prepare(
        `INSERT INTO prompts (key, system_prompt, model_override, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET
           system_prompt = ?, model_override = ?, updated_at = datetime('now')`
      ).run(key, systemPrompt, modelOverride ?? null, systemPrompt, modelOverride ?? null);
      return true;
    }
  );
}
