import { ipcMain } from "electron";
import { dbAll, dbGet, dbRun } from "../db/sqlite";

export function registerQueueHandlers(): void {
  ipcMain.handle("queue:list", (_e, status?: string) => {
    if (status) {
      return dbAll(
        "SELECT * FROM import_queue WHERE status = ? ORDER BY created_at DESC LIMIT 100",
        [status]
      );
    }
    return dbAll(
      "SELECT * FROM import_queue ORDER BY created_at DESC LIMIT 100"
    );
  });

  ipcMain.handle("queue:approve", (_e, id: number) => {
    dbRun("UPDATE import_queue SET status = 'pending' WHERE id = ?", [id]);
    return true;
  });

  ipcMain.handle("queue:reject", (_e, id: number) => {
    dbRun("DELETE FROM import_queue WHERE id = ?", [id]);
    return true;
  });

  ipcMain.handle("queue:update-parsed", (_e, id: number, parsedData: string) => {
    dbRun("UPDATE import_queue SET parsed_data = ? WHERE id = ?", [parsedData, id]);
    return true;
  });

  ipcMain.handle("queue:retry", (_e, id: number) => {
    dbRun(
      "UPDATE import_queue SET status = 'pending', error = NULL, retry_count = 0 WHERE id = ?",
      [id]
    );
    return true;
  });

  ipcMain.handle("queue:stats", () => {
    const rows = dbAll(
      "SELECT status, COUNT(*) as count FROM import_queue GROUP BY status"
    );
    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.status] = row.count;
    }
    return result;
  });
}
