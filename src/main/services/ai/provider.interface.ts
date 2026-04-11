export interface ExtractedMeta {
  contacts: {
    telegram: string | null;
    whatsapp: string | null;
    phone: string | null;
  };
  cities: string[];
  expiresAt: string | null;
  cleanedText: string;
  title: string;
}

export interface ExtractedRole {
  name: string;
  gender: "male" | "female" | "other" | "any";
  ageMin?: number;
  ageMax?: number;
  type: "lead" | "episodic" | "background";
  description?: string;
  payment?: string;
}

export interface ExtractedVacancy {
  professionName: string;
  payment?: string;
  schedule?: string;
  requirements?: string;
  description?: string;
}

export interface AiProvider {
  name: string;
  checkRelevance(text: string, prompt: string): Promise<"casting" | "technical" | "skip">;
  extractMeta(text: string, type: string, prompt: string): Promise<ExtractedMeta>;
  countItems(text: string, type: string, prompt: string): Promise<string[]>;
  extractRole(text: string, roleName: string, prompt: string): Promise<ExtractedRole>;
  extractVacancy(text: string, vacancyName: string, prompt: string): Promise<ExtractedVacancy>;
}
