import OpenAI from "openai";
import type {
  AiProvider,
  ExtractedMeta,
  ExtractedRole,
  ExtractedVacancy,
  StepKey,
} from "./provider.interface";

export interface StepConfig {
  model?: string;
  temperature?: number;
}

export type StepConfigResolver = (step: StepKey) => StepConfig;

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
    const today = new Date().toISOString().split("T")[0];
    const result = await this.chat("meta", prompt, `Type: ${type}\nToday: ${today}\n\n${text}`, true);
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

  async extractRole(
    text: string,
    roleName: string,
    prompt: string
  ): Promise<ExtractedRole> {
    const finalPrompt = prompt.replace("{roleName}", roleName);
    const result = await this.chat("role", finalPrompt, text, true);
    return this.parseJson<ExtractedRole>(result);
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
