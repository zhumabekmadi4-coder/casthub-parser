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
  const raw: string = row?.system_prompt ?? "";
  const today = new Date().toISOString().split("T")[0];
  return raw.replace(/\{nowDate\}/g, today);
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

interface SubPipelineResult {
  roles?: any[];
  vacancies?: any[];
}

// Build the appearance prompt — only inject the appearance-related reference lists.
function buildAppearancePrompt(): string {
  const dict = getDictionaries();
  const base = getPrompt("extract_role_appearance");
  const list = (arr: any[] | undefined) =>
    arr?.length ? arr.map((x) => x.code).join(", ") : "(unavailable)";

  return base
    .replace("{appearanceTypesList}", list(dict?.appearanceTypes))
    .replace("{bodyTypesList}", list(dict?.bodyTypes))
    .replace("{hairColorsList}", list(dict?.hairColors))
    .replace("{hairTypesList}", list(dict?.hairTypes))
    .replace("{eyeColorsList}", list(dict?.eyeColors))
    .replace("{faceTypesList}", list(dict?.faceTypes));
}

// Build the skills prompt — only languages and acting education lists.
function buildSkillsPrompt(): string {
  const dict = getDictionaries();
  const base = getPrompt("extract_role_skills");
  const list = (arr: any[] | undefined) =>
    arr?.length ? arr.map((x) => x.code).join(", ") : "(unavailable)";

  return base
    .replace("{languagesList}", list(dict?.languages))
    .replace("{actingEducationList}", list(dict?.actingEducation));
}

// Run the four role sub-extractions in parallel and merge into one role.
async function extractRoleParallel(
  ai: AiProvider,
  text: string,
  roleName: string,
  basicPrompt: string,
  appearancePrompt: string,
  skillsPrompt: string,
  measurementsPrompt: string
): Promise<ExtractedRole> {
  const [basic, appearance, skills, measurements] = await Promise.all([
    ai.extractRoleBasic(text, roleName, basicPrompt),
    ai.extractRoleAppearance(text, roleName, appearancePrompt),
    ai.extractRoleSkills(text, roleName, skillsPrompt),
    ai.extractRoleMeasurements(text, roleName, measurementsPrompt),
  ]);
  return { ...basic, ...appearance, ...skills, ...measurements };
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

function resolveCitiesFromMeta(cities: string[]): { cityId?: string; cityIds?: string[] } {
  if (cities.length === 1) {
    const id = resolveCityName(cities[0]);
    return id ? { cityId: id } : {};
  }
  if (cities.length > 1) {
    const resolved = cities.map(resolveCityName).filter((id): id is string => !!id);
    return resolved.length > 0 ? { cityIds: resolved } : {};
  }
  return {};
}

function finalizeExpiresAt(metaExpiresAt: string | null, baseDateMs: number): string {
  if (metaExpiresAt) return metaExpiresAt;
  const defaultDays = parseInt(getSetting("default_expiration_days") || "3");
  return new Date(baseDateMs + defaultDays * 24 * 60 * 60 * 1000).toISOString();
}

async function runCastingPipeline(
  ai: AiProvider,
  text: string,
  meta: ExtractedMeta
): Promise<SubPipelineResult> {
  let roleNames: string[];
  try {
    roleNames = await ai.countRoles(meta.cleanedText, getPrompt("count_roles"));
  } catch (err) {
    throw new Error(`count_roles failed: ${err}`);
  }
  if (!roleNames.length) roleNames = ["Роль"];

  const basicPrompt = getPrompt("extract_role_basic");
  const appearancePrompt = buildAppearancePrompt();
  const skillsPrompt = buildSkillsPrompt();
  const measurementsPrompt = getPrompt("extract_role_measurements");

  const results = await Promise.allSettled(
    roleNames.map((name) =>
      extractRoleParallel(ai, text, name, basicPrompt, appearancePrompt, skillsPrompt, measurementsPrompt)
        .then((role) => enrichRole(role))
    )
  );

  const roles: any[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") roles.push(r.value);
    else console.error(`Failed to extract role ${roleNames[i]}:`, r.reason);
  }
  return { roles };
}

async function runTechnicalPipeline(
  ai: AiProvider,
  text: string,
  meta: ExtractedMeta
): Promise<SubPipelineResult> {
  let vacancyNames: string[];
  try {
    vacancyNames = await ai.countVacancies(meta.cleanedText, getPrompt("count_vacancies"));
  } catch (err) {
    throw new Error(`count_vacancies failed: ${err}`);
  }
  if (!vacancyNames.length) vacancyNames = ["Вакансия"];

  const profCache = getProfessionsCache();
  const profList = profCache ? profCache.map((p: any) => p.nameRu).join(", ") : "";
  const vacancyPrompt = getPrompt("extract_vacancy").replace("{professionsList}", profList);

  const results = await Promise.allSettled(
    vacancyNames.map((name) => ai.extractVacancy(text, name, vacancyPrompt))
  );

  const vacancies: any[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      const v: any = r.value;
      const profId = resolveProfessionName(v.professionName);
      if (profId) v.professionId = profId;
      vacancies.push(v);
    } else {
      console.error(`Failed to extract vacancy ${vacancyNames[i]}:`, r.reason);
    }
  }
  return { vacancies };
}

export async function processMessage(msg: MessagePayload): Promise<void> {
  const { chatId, messageId, date, senderUserId, forwardInfo } = msg;

  const text = msg.text ? sanitizeText(msg.text) : null;
  if (!text || text.length < 20) return;

  const forwardOrigin = forwardInfo?.origin
    ? `${forwardInfo.origin.chat_id || ""}:${forwardInfo.origin.message_id || ""}`
    : null;

  if (isDuplicate(chatId, messageId, text, forwardOrigin)) {
    logEvent({ type: "skipped", reason: "duplicate", chatId, messageId });
    return;
  }

  const ai = getOrCreateProvider();

  let classification: "casting" | "technical" | "skip";
  try {
    classification = await ai.checkRelevance(text, getPrompt("relevance_check"));
  } catch (err) {
    markProcessed(chatId, messageId, text, "error", forwardOrigin);
    logEvent({ type: "error", step: "relevance", error: String(err), chatId, messageId });
    return;
  }

  if (classification === "skip") {
    markProcessed(chatId, messageId, text, "skip", forwardOrigin);
    logEvent({ type: "skipped", reason: "irrelevant", chatId, messageId, preview: text.substring(0, 80) });
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

  // Contact fallback via TDLib getUser
  const hasContact = meta.contacts.telegram || meta.contacts.whatsapp || meta.contacts.phone;
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

  const finalHasContact = meta.contacts.telegram || meta.contacts.whatsapp || meta.contacts.phone;
  if (!finalHasContact) {
    markProcessed(chatId, messageId, text, classification, forwardOrigin);
    logEvent({ type: "skipped", reason: "no_contacts", chatId, messageId });
    return;
  }

  await loadDictionaries();

  let sub: SubPipelineResult;
  try {
    sub = classification === "casting"
      ? await runCastingPipeline(ai, text, meta)
      : await runTechnicalPipeline(ai, text, meta);
  } catch (err) {
    enqueueFailed(chatId, messageId, text, "ai_failed", String(err));
    markProcessed(chatId, messageId, text, classification, forwardOrigin);
    return;
  }

  const roles = sub.roles ?? [];
  const vacancies = sub.vacancies ?? [];
  if (roles.length === 0 && vacancies.length === 0) {
    enqueueFailed(chatId, messageId, text, "ai_failed", "No roles/vacancies extracted");
    markProcessed(chatId, messageId, text, classification, forwardOrigin);
    return;
  }

  const expiresAt = finalizeExpiresAt(meta.expiresAt, date * 1000);
  const { cityId, cityIds } = resolveCitiesFromMeta(meta.cities);

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

      await loadDictionaries();

      const sub = classification === "casting"
        ? await runCastingPipeline(ai, text, meta)
        : await runTechnicalPipeline(ai, text, meta);

      const roles = sub.roles ?? [];
      const vacancies = sub.vacancies ?? [];
      const expiresAt = finalizeExpiresAt(meta.expiresAt, Date.now());
      const { cityId, cityIds } = resolveCitiesFromMeta(meta.cities);

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
