import { ipcMain } from "electron";
import { getDb } from "../db/sqlite";

export interface QueueItem {
  id: number;
  content_hash: string;
  raw_text: string;
  parsed_data: string;
  status: string;
  casthub_project_id: string | null;
  error: string | null;
  retry_count: number;
  created_at: string;
  delivered_at: string | null;
}

export function registerQueueHandlers(): void {
  ipcMain.handle("queue:list", (_e, status?: string) => {
    const db = getDb();
    if (status) {
      return db
        .prepare(
          "SELECT * FROM import_queue WHERE status = ? ORDER BY created_at DESC LIMIT 100"
        )
        .all(status);
    }
    return db
      .prepare("SELECT * FROM import_queue ORDER BY created_at DESC LIMIT 100")
      .all();
  });

  ipcMain.handle("queue:approve", (_e, id: number) => {
    const db = getDb();
    db.prepare("UPDATE import_queue SET status = 'pending' WHERE id = ?").run(id);
    return true;
  });

  ipcMain.handle("queue:reject", (_e, id: number) => {
    const db = getDb();
    db.prepare("DELETE FROM import_queue WHERE id = ?").run(id);
    return true;
  });

  ipcMain.handle("queue:update-parsed", (_e, id: number, parsedData: string) => {
    const db = getDb();
    db.prepare("UPDATE import_queue SET parsed_data = ? WHERE id = ?").run(
      parsedData,
      id
    );
    return true;
  });

  ipcMain.handle("queue:retry", (_e, id: number) => {
    const db = getDb();
    db.prepare(
      "UPDATE import_queue SET status = 'pending', error = NULL, retry_count = 0 WHERE id = ?"
    ).run(id);
    return true;
  });

  ipcMain.handle("queue:stats", () => {
    const db = getDb();
    const stats = db
      .prepare(
        `SELECT
          status,
          COUNT(*) as count
        FROM import_queue
        GROUP BY status`
      )
      .all() as { status: string; count: number }[];

    const result: Record<string, number> = {};
    for (const row of stats) {
      result[row.status] = row.count;
    }
    return result;
  });
}
