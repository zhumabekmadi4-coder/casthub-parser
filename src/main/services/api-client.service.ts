import { ipcMain, BrowserWindow } from "electron";
import { dbAll, dbGet, dbRun } from "../db/sqlite";
import { logEvent } from "./pipeline.service";

function getSetting(key: string): string {
  const row = dbGet("SELECT value FROM settings WHERE key = ?", [key]);
  return row?.value ?? "";
}

function sendToRenderer(channel: string, ...args: any[]) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args);
  }
}

// ============ Dictionary cache ============

interface NamedEntry {
  id: string;
  nameRu: string;
}
interface CodedEntry {
  id: string;
  code: string;
}

interface Dictionaries {
  cities: NamedEntry[];
  professions: NamedEntry[];
  appearanceTypes: CodedEntry[];
  bodyTypes: CodedEntry[];
  hairColors: CodedEntry[];
  hairTypes: CodedEntry[];
  eyeColors: CodedEntry[];
  faceTypes: CodedEntry[];
  actingEducation: CodedEntry[];
  languages: CodedEntry[];
}

let dictionariesCache: Dictionaries | null = null;
let dictionariesLoadedAt: string | null = null;
let dictionariesError: string | null = null;
let dictionariesRefreshTimer: ReturnType<typeof setInterval> | null = null;

function emitDictionaryStatus() {
  sendToRenderer("dictionaries:status", {
    loaded: !!dictionariesCache,
    lastUpdate: dictionariesLoadedAt,
    error: dictionariesError,
  });
}

async function fetchDictionariesOnce(): Promise<Dictionaries> {
  const apiUrl = getSetting("casthub_api_url");
  if (!apiUrl) throw new Error("casthub_api_url is empty");
  const res = await fetch(`${apiUrl}/api/dictionaries/all`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()) as Dictionaries;
}

export async function loadDictionaries(force = false): Promise<Dictionaries | null> {
  if (dictionariesCache && !force) return dictionariesCache;

  const delays = [0, 1000, 3000, 10_000];
  for (let attempt = 0; attempt < delays.length; attempt++) {
    if (delays[attempt]) await new Promise((r) => setTimeout(r, delays[attempt]));
    try {
      dictionariesCache = await fetchDictionariesOnce();
      dictionariesLoadedAt = new Date().toISOString();
      dictionariesError = null;
      emitDictionaryStatus();
      return dictionariesCache;
    } catch (err) {
      dictionariesError = String(err);
      logEvent({ type: "dict_error", attempt: attempt + 1, error: dictionariesError });
      if (attempt === delays.length - 1) {
        emitDictionaryStatus();
        return null;
      }
    }
  }
  return null;
}

function startDictionaryRefreshTimer() {
  if (dictionariesRefreshTimer) return;
  // Refresh every hour
  dictionariesRefreshTimer = setInterval(() => {
    loadDictionaries(true).catch(() => {});
  }, 60 * 60 * 1000);
}

// ============ Resolvers ============

function lookupByName<T extends { nameRu?: string; code?: string }>(
  list: T[] | undefined,
  query: string,
  field: "nameRu" | "code"
): string | null {
  if (!list || !query) return null;
  const lower = query.toLowerCase().trim();
  const found = list.find((item) => (item as any)[field]?.toLowerCase() === lower);
  return found ? (found as any).id : null;
}

export function resolveCityName(name: string): string | null {
  return lookupByName(dictionariesCache?.cities, name, "nameRu");
}

export function resolveProfessionName(name: string): string | null {
  return lookupByName(dictionariesCache?.professions, name, "nameRu");
}

export function resolveAppearanceType(code: string): string | null {
  return lookupByName(dictionariesCache?.appearanceTypes, code, "code");
}
export function resolveBodyType(code: string): string | null {
  return lookupByName(dictionariesCache?.bodyTypes, code, "code");
}
export function resolveHairColor(code: string): string | null {
  return lookupByName(dictionariesCache?.hairColors, code, "code");
}
export function resolveHairType(code: string): string | null {
  return lookupByName(dictionariesCache?.hairTypes, code, "code");
}
export function resolveEyeColor(code: string): string | null {
  return lookupByName(dictionariesCache?.eyeColors, code, "code");
}
export function resolveFaceType(code: string): string | null {
  return lookupByName(dictionariesCache?.faceTypes, code, "code");
}
export function resolveActingEducation(code: string): string | null {
  return lookupByName(dictionariesCache?.actingEducation, code, "code");
}
export function resolveLanguage(code: string): string | null {
  return lookupByName(dictionariesCache?.languages, code, "code");
}

// Snapshots for prompt building
export function getDictionaries(): Dictionaries | null {
  return dictionariesCache;
}
export function getCitiesCache() {
  return dictionariesCache?.cities ?? null;
}
export function getProfessionsCache() {
  return dictionariesCache?.professions ?? null;
}

// ============ Delivery loop ============

async function deliverSingleItem(item: any): Promise<{ ok: boolean; error?: string; projectId?: string }> {
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

async function deliveryLoop(): Promise<{ delivered: number; failed: number }> {
  const items = dbAll(
    "SELECT * FROM import_queue WHERE status = 'pending' AND retry_count < 5 ORDER BY created_at ASC LIMIT 20"
  );

  if (!items.length) return { delivered: 0, failed: 0 };

  const apiUrl = getSetting("casthub_api_url");
  const apiKey = getSetting("casthub_api_key");

  if (!apiUrl || !apiKey) {
    logEvent({ type: "error", error: "CastHub API not configured" });
    return { delivered: 0, failed: 0 };
  }

  const payloads = items.map((item: any) => ({
    item,
    parsed: JSON.parse(item.parsed_data),
  }));

  let delivered = 0;
  let failed = 0;

  try {
    const response = await fetch(`${apiUrl}/api/import/batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ items: payloads.map((p) => p.parsed) }),
    });

    if (!response.ok) {
      const body = await response.text();
      const error = `Batch HTTP ${response.status}: ${body}`;
      for (const { item } of payloads) {
        const retryCount = item.retry_count + 1;
        dbRun(
          "UPDATE import_queue SET status = ?, error = ?, retry_count = ? WHERE id = ?",
          [retryCount >= 5 ? "failed" : "pending", error, retryCount, item.id]
        );
        failed++;
      }
      logEvent({ type: "error", error });
      return { delivered, failed };
    }

    const result = await response.json();

    for (const { item, parsed } of payloads) {
      const itemResult = result.results?.find(
        (r: any) => r.externalId === parsed.externalId
      );

      if (!itemResult) {
        dbRun(
          "UPDATE import_queue SET status = 'pending', error = 'Missing from batch response', retry_count = retry_count + 1 WHERE id = ?",
          [item.id]
        );
        failed++;
        continue;
      }

      if (itemResult.status === "error") {
        const retryCount = item.retry_count + 1;
        dbRun(
          "UPDATE import_queue SET status = ?, error = ?, retry_count = ? WHERE id = ?",
          [retryCount >= 5 ? "failed" : "pending", itemResult.error || "Server error", retryCount, item.id]
        );
        failed++;
        if (retryCount >= 5) {
          logEvent({ type: "error", error: `Delivery failed after 5 retries: ${itemResult.error}` });
        }
      } else {
        dbRun(
          "UPDATE import_queue SET status = 'delivered', casthub_project_id = ?, delivered_at = datetime('now') WHERE id = ?",
          [itemResult.id || "duplicate", item.id]
        );
        delivered++;
        logEvent({
          type: "delivered",
          title: parsed.title,
          projectId: itemResult.id,
        });
      }
    }
  } catch (err) {
    const error = String(err);
    for (const { item } of payloads) {
      const retryCount = item.retry_count + 1;
      dbRun(
        "UPDATE import_queue SET status = ?, error = ?, retry_count = ? WHERE id = ?",
        [retryCount >= 5 ? "failed" : "pending", error, retryCount, item.id]
      );
      failed++;
    }
    logEvent({ type: "error", error: `Batch delivery error: ${error}` });
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
  // Kick off dictionary loading on startup, don't block
  loadDictionaries().catch(() => {});
  startDictionaryRefreshTimer();

  const autoPublish = getSetting("auto_publish");
  if (autoPublish === "true") {
    startDeliveryLoop();
  }

  ipcMain.handle("api:deliver-now", async () => {
    return await deliveryLoop();
  });

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

  ipcMain.handle("dictionaries:get-status", () => ({
    loaded: !!dictionariesCache,
    lastUpdate: dictionariesLoadedAt,
    error: dictionariesError,
    counts: dictionariesCache
      ? {
          cities: dictionariesCache.cities.length,
          professions: dictionariesCache.professions.length,
          appearanceTypes: dictionariesCache.appearanceTypes.length,
          bodyTypes: dictionariesCache.bodyTypes.length,
          hairColors: dictionariesCache.hairColors.length,
          hairTypes: dictionariesCache.hairTypes.length,
          eyeColors: dictionariesCache.eyeColors.length,
          faceTypes: dictionariesCache.faceTypes.length,
          actingEducation: dictionariesCache.actingEducation.length,
          languages: dictionariesCache.languages.length,
        }
      : null,
  }));

  ipcMain.handle("dictionaries:reload", async () => {
    const result = await loadDictionaries(true);
    return { ok: !!result, error: dictionariesError };
  });
}
