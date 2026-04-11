import { ipcMain } from "electron";
import { dbAll, dbGet, dbRun } from "../db/sqlite";

export function registerSettingsHandlers(): void {
  ipcMain.handle("settings:get-all", () => {
    const rows = dbAll("SELECT key, value FROM settings");
    const settings: Record<string, string> = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    return settings;
  });

  ipcMain.handle("settings:get", (_e, key: string) => {
    const row = dbGet("SELECT value FROM settings WHERE key = ?", [key]);
    return row?.value ?? null;
  });

  ipcMain.handle("settings:set", (_e, key: string, value: string) => {
    dbRun(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?",
      [key, value, value]
    );
    return true;
  });

  // Prompts
  ipcMain.handle("prompts:get-all", () => {
    return dbAll(
      "SELECT key, system_prompt, model_override, updated_at FROM prompts"
    );
  });

  ipcMain.handle(
    "prompts:set",
    (_e, key: string, systemPrompt: string, modelOverride?: string) => {
      dbRun(
        `INSERT INTO prompts (key, system_prompt, model_override, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET
           system_prompt = ?, model_override = ?, updated_at = datetime('now')`,
        [key, systemPrompt, modelOverride ?? null, systemPrompt, modelOverride ?? null]
      );
      return true;
    }
  );
}
