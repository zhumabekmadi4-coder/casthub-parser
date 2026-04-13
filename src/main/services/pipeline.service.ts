import { ipcMain, BrowserWindow } from "electron";
import { dbGet, dbRun } from "../db/sqlite";
import { isDuplicate, markProcessed, externalIdHash, cleanOldEntries } from "./dedup.service";
import { OpenAIProvider, type StepConfig } from "./ai/openai.provider";
import type { AiProvider, ExtractedMeta, ExtractedRole, StepKey } from "./ai/provider.interface";
import {
  resolveCityName,
  resolveProfessionName,
  resolveAppearanceType,
  resolveBodyType,
  resolveHairColor,
  resolveHairType,
  resolveEyeColor,
  resolveFaceType,
  resolveActingEducation,
  resolveLanguage,
  loadDictionaries,
  getDictionaries,
  getProfessionsCache,
} from "./api-client.service";
import { sanitizeText } from "./sanitize";

let provider: AiProvider | null = null;

const eventLog: any[] = [];
const MAX_LOG_SIZE = 500;

function sendToRenderer(channel: string, ...args: any[]) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, ...args);
  }
}

export function logEvent(event: any) {
  const entry = { ...event, _time: new Date().toISOString() };
  eventLog.unshift(entry);
  if (eventLog.length > MAX_LOG_SIZE) eventLog.length = MAX_LOG_SIZE;
  sendToRenderer("pipeline:event", entry);
}

function getPrompt(key: string): string {
  const row = dbGet("SELECT system_prompt FROM prompts WHERE key = ?", [key]);
  return row?.system_prompt ?? "";
}

function getSetting(key: string): string {
  const row = dbGet("SELECT value FROM settings WHERE key = ?", [key]);
  return row?.value ?? "";
}

function resolveStepConfig(step: StepKey): StepConfig {
  const model = getSetting(`ai_model_${step}`);
  const tempRaw = getSetting(`ai_temp_${step}`);
  const temperature = tempRaw ? parseFloat(tempRaw) : undefined;
  return {
    model: model || undefined,
    temperature: Number.isFinite(temperature as number) ? temperature : undefined,
  };
}

function getOrCreateProvider(): AiProvider {
  if (provider) return provider;

  const apiKey = getSetting("ai_api_key");
  const model = getSetting("ai_model");

  if (!apiKey) throw new Error("AI API key not configured");

  provider = new OpenAIProvider(apiKey, model || "gpt-4o-mini", resolveStepConfig);
  return provider;
}

export function resetProvider() {
  provider = null;
}

export interface MessagePayload {
  chatId: number;
  messageId: number;
  threadId?: number | null;
  text: string;
  date: number;
  senderUserId: number | null;
  forwardInfo: any;
}

// Build the role prompt by injecting all reference list snippets
function buildRolePrompt(): string {
  const dict = getDictionaries();
  const base = getPrompt("extract_role");
  const list = (arr: any[] | undefined, field: "code" | "nameRu") =>
    arr?.length ? arr.map((x) => x[field]).join(", ") : "(unavailable)";

  return base
    .replace("{languagesList}", list(dict?.languages, "code"))
    .replace("{appearanceTypesList}", list(dict?.appearanceTypes, "code"))
    .replace("{bodyTypesList}", list(dict?.bodyTypes, "code"))
    .replace("{hairColorsList}", list(dict?.hairColors, "code"))
    .replace("{hairTypesList}", list(dict?.hairTypes, "code"))
    .replace("{eyeColorsList}", list(dict?.eyeColors, "code"))
    .replace("{faceTypesList}", list(dict?.faceTypes, "code"))
    .replace("{actingEducationList}", list(dict?.actingEducation, "code"));
}

// Resolve role's reference codes → UUIDs, drop fields where dictionary is missing
function enrichRole(role: ExtractedRole): any {
  return {
    ...role,
    appearanceTypeId: role.appearanceType ? resolveAppearanceType(role.appearanceType) : null,
    bodyTypeId: role.bodyType ? resolveBodyType(role.bodyType) : null,
    hairColorId: role.hairColor ? resolveHairColor(role.hairColor) : null,
    hairTypeId: role.hairType ? resolveHairType(role.hairType) : null,
    eyeColorId: role.eyeColor ? resolveEyeColor(role.eyeColor) : null,
    faceTypeId: role.faceType ? resolveFaceType(role.faceType) : null,
    actingEducationId: role.actingEducation ? resolveActingEducation(role.actingEducation) : null,
    languageIds: role.languages?.length
      ? role.languages.map((c) => resolveLanguage(c)).filter((id): id is string => !!id)
      : undefined,
  };
}

export async function processMessage(msg: MessagePayload): Promise<void> {
  const { chatId, messageId, date, senderUserId, forwardInfo } = msg;

  const text = msg.text ? sanitizeText(msg.text) : null;

  if (!text || text.length < 20) return;

  const forwardOrigin = forwardInfo?.origin
    ? `${forwardInfo.origin.chat_id || ""}:${forwardInfo.origin.message_id || ""}`
    : null;

  if (isDuplicate(chatId, messageId, text, forwardOrigin)) {
    logEvent({
      type: "skipped",
      reason: "duplicate",
      chatId,
      messageId,
    });
    return;
  }

  const ai = getOrCreateProvider();

  let classification: "casting" | "technical" | "skip";
  try {
    classification = await ai.checkRelevance(text, getPrompt("relevance_check"));
  } catch (err) {
    markProcessed(chatId, messageId, text, "error", forwardOrigin);
    logEvent({
      type: "error",
      step: "relevance",
      error: String(err),
      chatId,
      messageId,
    });
    return;
  }

  if (classification === "skip") {
    markProcessed(chatId, messageId, text, "skip", forwardOrigin);
    logEvent({
      type: "skipped",
      reason: "irrelevant",
      chatId,
      messageId,
      preview: text.substring(0, 80),
    });
    return;
  }

  let meta: ExtractedMeta;
  try {
    meta = await ai.extractMeta(text, classification, getPrompt("extract_meta"));
  } catch (err) {
    enqueueFailed(chatId, messageId, text, "ai_failed", `Meta extraction failed: ${err}`);
    markProcessed(chatId, messageId, text, classification, forwardOrigin);
    return;
  }

  const hasContact =
    meta.contacts.telegram || meta.contacts.whatsapp || meta.contacts.phone;

  if (!hasContact && senderUserId) {
    try {
      const tdlib = require("./tdlib.service");
      const client = tdlib.getClient();
      if (client) {
        const user = await client.invoke({ _: "getUser", user_id: senderUserId });
        if (user?.usernames?.active_usernames?.length) {
          meta.contacts.telegram = "@" + user.usernames.active_usernames[0];
        }
      }
    } catch {
      // Ignore lookup failure
    }
  }

  const finalHasContact =
    meta.contacts.telegram || meta.contacts.whatsapp || meta.contacts.phone;
  if (!finalHasContact) {
    markProcessed(chatId, messageId, text, classification, forwardOrigin);
    logEvent({
      type: "skipped",
      reason: "no_contacts",
      chatId,
      messageId,
    });
    return;
  }

  await loadDictionaries();

  let itemNames: string[];
  try {
    itemNames = await ai.countItems(
      meta.cleanedText,
      classification,
      getPrompt("count_items")
    );
  } catch (err) {
    enqueueFailed(chatId, messageId, text, "ai_failed", `Count items failed: ${err}`);
    markProcessed(chatId, messageId, text, classification, forwardOrigin);
    return;
  }

  if (!itemNames.length) {
    itemNames = [classification === "casting" ? "Роль" : "Вакансия"];
  }

  const roles: any[] = [];
  const vacancies: any[] = [];

  let vacancyPrompt = getPrompt("extract_vacancy");
  if (classification === "technical") {
    const profCache = getProfessionsCache();
    const profList = profCache ? profCache.map((p: any) => p.nameRu).join(", ") : "";
    vacancyPrompt = vacancyPrompt.replace("{professionsList}", profList);
  }

  const rolePrompt = classification === "casting" ? buildRolePrompt() : "";

  for (const name of itemNames) {
    try {
      if (classification === "casting") {
        const role = await ai.extractRole(text, name, rolePrompt);
        roles.push(enrichRole(role));
      } else {
        const vacancy = await ai.extractVacancy(text, name, vacancyPrompt);
        vacancies.push(vacancy);
      }
    } catch (err) {
      console.error(`Failed to extract ${name}:`, err);
    }
  }

  if (roles.length === 0 && vacancies.length === 0) {
    enqueueFailed(chatId, messageId, text, "ai_failed", "No roles/vacancies extracted");
    markProcessed(chatId, messageId, text, classification, forwardOrigin);
    return;
  }

  const defaultDays = parseInt(getSetting("default_expiration_days") || "3");
  let expiresAt = meta.expiresAt;
  if (!expiresAt) {
    const d = new Date(date * 1000 + defaultDays * 24 * 60 * 60 * 1000);
    expiresAt = d.toISOString();
  }

  let cityId: string | undefined;
  let cityIds: string[] | undefined;

  if (meta.cities.length === 1) {
    cityId = resolveCityName(meta.cities[0]) || undefined;
  } else if (meta.cities.length > 1) {
    const resolved = meta.cities.map(resolveCityName).filter((id): id is string => !!id);
    if (resolved.length > 0) cityIds = resolved;
  }

  if (classification === "technical" && vacancies.length > 0) {
    for (const v of vacancies) {
      const profId = resolveProfessionName(v.professionName);
      if (profId) v.professionId = profId;
    }
  }

  const parsedData = {
    externalId: externalIdHash(chatId, messageId),
    title: meta.title,
    description: meta.cleanedText.substring(0, 2000),
    type: classification,
    city: meta.cities[0] || undefined,
    cityId,
    cityIds,
    cities: meta.cities.length ? meta.cities : undefined,
    whatsapp: meta.contacts.whatsapp || undefined,
    telegram: meta.contacts.telegram || undefined,
    phone: meta.contacts.phone || undefined,
    expiresAt,
    sourceUrl: `https://t.me/c/${Math.abs(chatId)}/${messageId}`,
    roles: classification === "casting" ? roles : undefined,
    vacancies: classification === "technical" ? vacancies : undefined,
  };

  const autoPublish = getSetting("auto_publish") === "true";

  dbRun(
    `INSERT INTO import_queue (content_hash, raw_text, parsed_data, status)
     VALUES (?, ?, ?, ?)`,
    [
      externalIdHash(chatId, messageId),
      text,
      JSON.stringify(parsedData),
      autoPublish ? "pending" : "review",
    ]
  );

  markProcessed(chatId, messageId, text, classification, forwardOrigin);

  logEvent({
    type: "processed",
    classification,
    title: meta.title,
    rolesCount: roles.length,
    vacanciesCount: vacancies.length,
    status: autoPublish ? "pending" : "review",
    chatId,
    messageId,
  });
}

function enqueueFailed(
  chatId: number,
  messageId: number,
  text: string,
  status: string,
  error: string
) {
  dbRun(
    `INSERT INTO import_queue (content_hash, raw_text, parsed_data, status, error)
     VALUES (?, ?, ?, ?, ?)`,
    [externalIdHash(chatId, messageId), text, "{}", status, error]
  );

  logEvent({
    type: "error",
    error,
    chatId,
    messageId,
  });
}

export function registerPipelineHandlers(): void {
  ipcMain.handle("pipeline:get-logs", () => {
    return eventLog;
  });

  ipcMain.handle("pipeline:clear-logs", () => {
    eventLog.length = 0;
    return true;
  });

  ipcMain.handle("pipeline:process", async (_e, msg: MessagePayload) => {
    try {
      await processMessage(msg);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("pipeline:reset-provider", () => {
    resetProvider();
    return true;
  });

  ipcMain.handle("pipeline:reprocess", async (_e, id: number) => {
    const item = dbGet("SELECT * FROM import_queue WHERE id = ?", [id]);
    if (!item) return { ok: false, error: "Item not found" };

    const ai = getOrCreateProvider();
    const text = sanitizeText(item.raw_text);

    try {
      const classification = await ai.checkRelevance(text, getPrompt("relevance_check"));
      if (classification === "skip") {
        dbRun(
          "UPDATE import_queue SET status = 'review', error = 'AI classified as irrelevant', parsed_data = '{}' WHERE id = ?",
          [id]
        );
        return { ok: true, status: "irrelevant" };
      }

      const meta = await ai.extractMeta(text, classification, getPrompt("extract_meta"));

      let itemNames = await ai.countItems(meta.cleanedText, classification, getPrompt("count_items"));
      if (!itemNames.length) itemNames = [classification === "casting" ? "Роль" : "Вакансия"];

      await loadDictionaries();

      let reprocessVacancyPrompt = getPrompt("extract_vacancy");
      if (classification === "technical") {
        const profCache = getProfessionsCache();
        const profList = profCache ? profCache.map((p: any) => p.nameRu).join(", ") : "";
        reprocessVacancyPrompt = reprocessVacancyPrompt.replace("{professionsList}", profList);
      }

      const reprocessRolePrompt = classification === "casting" ? buildRolePrompt() : "";

      const roles: any[] = [];
      const vacancies: any[] = [];
      for (const name of itemNames) {
        if (classification === "casting") {
          const role = await ai.extractRole(text, name, reprocessRolePrompt);
          roles.push(enrichRole(role));
        } else {
          vacancies.push(await ai.extractVacancy(text, name, reprocessVacancyPrompt));
        }
      }

      const defaultDays = parseInt(getSetting("default_expiration_days") || "3");
      let expiresAt = meta.expiresAt;
      if (!expiresAt) {
        expiresAt = new Date(Date.now() + defaultDays * 86400000).toISOString();
      }

      let cityId: string | undefined;
      let cityIds: string[] | undefined;
      if (meta.cities.length === 1) {
        cityId = resolveCityName(meta.cities[0]) || undefined;
      } else if (meta.cities.length > 1) {
        const resolved = meta.cities.map(resolveCityName).filter((x): x is string => !!x);
        if (resolved.length > 0) cityIds = resolved;
      }

      if (classification === "technical") {
        for (const v of vacancies) {
          const profId = resolveProfessionName(v.professionName);
          if (profId) v.professionId = profId;
        }
      }

      const parsedData = {
        externalId: item.content_hash,
        title: meta.title,
        description: meta.cleanedText.substring(0, 2000),
        type: classification,
        city: meta.cities[0] || undefined,
        cityId,
        cityIds,
        cities: meta.cities.length ? meta.cities : undefined,
        whatsapp: meta.contacts.whatsapp || undefined,
        telegram: meta.contacts.telegram || undefined,
        phone: meta.contacts.phone || undefined,
        expiresAt,
        roles: classification === "casting" ? roles : undefined,
        vacancies: classification === "technical" ? vacancies : undefined,
      };

      dbRun(
        "UPDATE import_queue SET parsed_data = ?, status = 'review', error = NULL WHERE id = ?",
        [JSON.stringify(parsedData), id]
      );

      return { ok: true, status: "reprocessed" };
    } catch (err) {
      dbRun("UPDATE import_queue SET error = ? WHERE id = ?", [String(err), id]);
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("pipeline:clean-dedup", () => {
    const days = parseInt(getSetting("dedup_cache_days") || "7");
    const cleaned = cleanOldEntries(days);
    return { cleaned };
  });
}
