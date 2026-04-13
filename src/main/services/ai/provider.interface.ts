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
  type: "lead" | "episodic" | "background";
  ageMin?: number;
  ageMax?: number;
  heightMin?: number;
  heightMax?: number;
  weightMin?: number;
  weightMax?: number;
  bust?: number;
  waist?: number;
  hips?: number;
  languages?: string[];
  appearanceType?: string;
  bodyType?: string;
  hairColor?: string;
  hairType?: string;
  eyeColor?: string;
  faceType?: string;
  actingEducation?: string;
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

export type StepKey = "relevance" | "meta" | "count" | "role" | "vacancy";

export interface AiProvider {
  name: string;
  checkRelevance(text: string, prompt: string): Promise<"casting" | "technical" | "skip">;
  extractMeta(text: string, type: string, prompt: string): Promise<ExtractedMeta>;
  countItems(text: string, type: string, prompt: string): Promise<string[]>;
  extractRole(text: string, roleName: string, prompt: string): Promise<ExtractedRole>;
  extractVacancy(text: string, vacancyName: string, prompt: string): Promise<ExtractedVacancy>;
}
