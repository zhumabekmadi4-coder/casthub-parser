import { ipcMain, BrowserWindow } from "electron";
import { dbAll, dbGet, dbRun } from "../db/sqlite";

function getSetting(key: string): string {
  const row = dbGet("SELECT value FROM settings WHERE key = ?", [key]);
  return row?.value ?? "";
}

// Cached dictionaries from CastHub
let citiesCache: { id: string; nameRu: string }[] | null = null;
let professionsCache: { id: string; nameRu: string }[] | null = null;

async function fetchCities(): Promise<{ id: string; nameRu: string }[]> {
  if (citiesCache) return citiesCache;
  const apiUrl = getSetting("casthub_api_url");
  try {
    const res = await fetch(`${apiUrl}/api/cities`);
    if (res.ok) {
      citiesCache = await res.json();
      return citiesCache!;
    }
  } catch {}
  return [];
}

async function fetchProfessions(): Promise<{ id: string; nameRu: string }[]> {
  if (professionsCache) return professionsCache;
  const apiUrl = getSetting("casthub_api_url");
  try {
    const res = await fetch(`${apiUrl}/api/professions`);
    if (res.ok) {
      professionsCache = await res.json();
      return professionsCache!;
    }
  } catch {}
  return [];
}

export function resolveCityName(name: string): string | null {
  if (!citiesCache) return null;
  const lower = name.toLowerCase().trim();
  const found = citiesCache.find((c) => c.nameRu.toLowerCase() === lower);
  return found?.id ?? null;
}

export function resolveProfessionName(name: string): string | null {
  if (!professionsCache) return null;
  const lower = name.toLowerCase().trim();
  const found = professionsCache.find((p) => p.nameRu.toLowerCase() === lower);
  return found?.id ?? null;
}

export async function loadDictionaries(): Promise<void> {
  await Promise.all([fetchCities(), fetchProfessions()]);
}

export function getCitiesCache() {
  return citiesCache;
}

export function getProfessionsCache() {
  return professionsCache;
}

function sendToRenderer(channel: string, ...args: any[]) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args);
  }
}

async function deliverItem(item: any): Promise<{ ok: boolean; error?: string; projectId?: string }> {
  const apiUrl = getSetting("casthub_api_url");
  const apiKey = getSetting("casthub_api_key");

  if (!apiUrl || !apiKey) {
    return { ok: false, error: "CastHub API not configured" };
  }

  const parsedData = JSON.parse(item.parsed_data);

  try {
    const response = await fetch(`${apiUrl}/api/import`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(parsedData),
    });

    if (response.status === 409) {
      // Duplicate — already exists on CastHub
      return { ok: true, projectId: "duplicate" };
    }

    if (!response.ok) {
      const body = await response.text();
      return { ok: false, error: `HTTP ${response.status}: ${body}` };
    }

    const result = await response.json();
    return { ok: true, projectId: result.id };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// Delivery loop — process pending items
async function deliveryLoop(): Promise<{ delivered: number; failed: number }> {
  const items = dbAll(
    "SELECT * FROM import_queue WHERE status = 'pending' AND retry_count < 5 ORDER BY created_at ASC LIMIT 10"
  );

  let delivered = 0;
  let failed = 0;

  for (const item of items) {
    const result = await deliverItem(item);

    if (result.ok) {
      dbRun(
        "UPDATE import_queue SET status = 'delivered', casthub_project_id = ?, delivered_at = datetime('now') WHERE id = ?",
        [result.projectId, item.id]
      );
      delivered++;

      sendToRenderer("pipeline:event", {
        type: "delivered",
        title: JSON.parse(item.parsed_data).title,
        projectId: result.projectId,
      });
    } else {
      const retryCount = item.retry_count + 1;
      const status = retryCount >= 5 ? "failed" : "pending";
      dbRun(
        "UPDATE import_queue SET status = ?, error = ?, retry_count = ? WHERE id = ?",
        [status, result.error, retryCount, item.id]
      );
      failed++;

      if (status === "failed") {
        sendToRenderer("pipeline:event", {
          type: "error",
          error: `Delivery failed after 5 retries: ${result.error}`,
        });
      }
    }

    // Small delay between deliveries
    await new Promise((r) => setTimeout(r, 500));
  }

  return { delivered, failed };
}

let deliveryInterval: ReturnType<typeof setInterval> | null = null;

function startDeliveryLoop() {
  if (deliveryInterval) return;
  deliveryInterval = setInterval(async () => {
    try {
      await deliveryLoop();
    } catch (err) {
      console.error("Delivery loop error:", err);
    }
  }, 30_000);
  deliveryLoop().catch(console.error);
}

export function registerApiClientHandlers(): void {
  // Auto-start delivery if auto_publish is enabled
  const autoPublish = getSetting("auto_publish");
  if (autoPublish === "true") {
    startDeliveryLoop();
  }

  // Manual delivery trigger
  ipcMain.handle("api:deliver-now", async () => {
    return await deliveryLoop();
  });

  // Test connection
  ipcMain.handle("api:test-connection", async () => {
    const apiUrl = getSetting("casthub_api_url");
    const apiKey = getSetting("casthub_api_key");

    if (!apiUrl || !apiKey) {
      return { ok: false, error: "API not configured" };
    }

    try {
      const response = await fetch(`${apiUrl}/api/cities`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      return { ok: response.ok, status: response.status };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Start auto-delivery (every 30 seconds)
  ipcMain.handle("api:start-delivery", () => {
    startDeliveryLoop();
    return { ok: true };
  });

  ipcMain.handle("api:stop-delivery", () => {
    if (deliveryInterval) {
      clearInterval(deliveryInterval);
      deliveryInterval = null;
    }
    return { ok: true };
  });
}
