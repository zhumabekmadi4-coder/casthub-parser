import OpenAI from "openai";
import type {
  AiProvider,
  ExtractedMeta,
  ExtractedRoleBasic,
  ExtractedRoleAppearance,
  ExtractedRoleSkills,
  ExtractedRoleMeasurements,
  ExtractedVacancy,
  StepKey,
} from "./provider.interface";
import { Semaphore } from "../concurrency";

export interface StepConfig {
  model?: string;
  temperature?: number;
}

export type StepConfigResolver = (step: StepKey) => StepConfig;

// Cap concurrent OpenAI requests across the whole app. With sync-history
// (5 messages in parallel) × 4 role sub-calls × multiple roles per message,
// unrestricted concurrency would burst into rate limits. 10 is a safe
// default for tier 1 and above.
const OPENAI_GLOBAL_CONCURRENCY = 10;
const openaiSemaphore = new Semaphore(OPENAI_GLOBAL_CONCURRENCY);

export class OpenAIProvider implements AiProvider {
  name = "openai";
  private client: OpenAI;
  private defaultModel: string;
  private resolveStepConfig: StepConfigResolver;

  constructor(
    apiKey: string,
    defaultModel: string = "gpt-4o-mini",
    resolveStepConfig?: StepConfigResolver
  ) {
    this.client = new OpenAI({ apiKey });
    this.defaultModel = defaultModel;
    this.resolveStepConfig = resolveStepConfig ?? (() => ({}));
  }

  private async chat(
    step: StepKey,
    systemPrompt: string,
    userMessage: string,
    jsonMode = false
  ): Promise<string> {
    const cfg = this.resolveStepConfig(step);
    const model = cfg.model || this.defaultModel;
    const temperature = cfg.temperature ?? 0.1;

    // Token cap: relevance is essentially yes/no/skip — small cap to stop runaway output.
    // All other steps are unbounded — let the model decide.
    const maxTokens = step === "relevance" ? 100 : undefined;

    return openaiSemaphore.run(async () => {
      const response = await this.client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature,
        ...(maxTokens !== undefined ? { max_tokens: maxTokens } : {}),
        ...(jsonMode ? { response_format: { type: "json_object" as const } } : {}),
      });
      return response.choices[0]?.message?.content?.trim() || "";
    });
  }

  private parseJson<T>(text: string): T {
    let cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    const arrMatch = cleaned.match(/\[[\s\S]*\]/);

    if (objMatch && (!arrMatch || objMatch.index! <= arrMatch.index!)) {
      cleaned = objMatch[0];
    } else if (arrMatch) {
      cleaned = arrMatch[0];
    }

    return JSON.parse(cleaned);
  }

  async checkRelevance(
    text: string,
    prompt: string
  ): Promise<"casting" | "technical" | "skip"> {
    const result = await this.chat("relevance", prompt, text);
    const lower = result.toLowerCase().trim();
    if (lower.includes("casting")) return "casting";
    if (lower.includes("technical")) return "technical";
    return "skip";
  }

  async extractMeta(
    text: string,
    type: string,
    prompt: string
  ): Promise<ExtractedMeta> {
    const result = await this.chat("meta", prompt, `Type: ${type}\n\n${text}`, true);
    return this.parseJson<ExtractedMeta>(result);
  }

  async countItems(
    text: string,
    type: string,
    prompt: string
  ): Promise<string[]> {
    const result = await this.chat(
      "count",
      prompt + "\nReturn JSON object with key \"items\" containing the array.",
      `Type: ${type}\n\n${text}`,
      true
    );
    const parsed = this.parseJson<{ items: string[] }>(result);
    return parsed.items || [];
  }

  async extractRoleBasic(
    text: string,
    roleName: string,
    prompt: string
  ): Promise<ExtractedRoleBasic> {
    const finalPrompt = prompt.replace("{roleName}", roleName);
    const result = await this.chat("role", finalPrompt, text, true);
    return this.parseJson<ExtractedRoleBasic>(result);
  }

  async extractRoleAppearance(
    text: string,
    roleName: string,
    prompt: string
  ): Promise<ExtractedRoleAppearance> {
    const finalPrompt = prompt.replace("{roleName}", roleName);
    const result = await this.chat("role", finalPrompt, text, true);
    return this.parseJson<ExtractedRoleAppearance>(result);
  }

  async extractRoleSkills(
    text: string,
    roleName: string,
    prompt: string
  ): Promise<ExtractedRoleSkills> {
    const finalPrompt = prompt.replace("{roleName}", roleName);
    const result = await this.chat("role", finalPrompt, text, true);
    return this.parseJson<ExtractedRoleSkills>(result);
  }

  async extractRoleMeasurements(
    text: string,
    roleName: string,
    prompt: string
  ): Promise<ExtractedRoleMeasurements> {
    const finalPrompt = prompt.replace("{roleName}", roleName);
    const result = await this.chat("role", finalPrompt, text, true);
    return this.parseJson<ExtractedRoleMeasurements>(result);
  }

  async extractVacancy(
    text: string,
    vacancyName: string,
    prompt: string
  ): Promise<ExtractedVacancy> {
    const finalPrompt = prompt.replace("{vacancyName}", vacancyName);
    const result = await this.chat("vacancy", finalPrompt, text, true);
    return this.parseJson<ExtractedVacancy>(result);
  }
}
