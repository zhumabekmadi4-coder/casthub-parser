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

// Role extraction is split into 4 independent sub-calls to keep each prompt
// small (only the relevant slice of the reference dictionary) and to allow
// the sub-calls to run in parallel for one role.
export interface ExtractedRoleBasic {
  name: string;
  gender: "male" | "female" | "other" | "any";
  type: "lead" | "episodic" | "background";
  ageMin?: number | null;
  ageMax?: number | null;
  description?: string | null;
  payment?: string | null;
}

export interface ExtractedRoleAppearance {
  appearanceType?: string | null;
  bodyType?: string | null;
  hairColor?: string | null;
  hairType?: string | null;
  eyeColor?: string | null;
  faceType?: string | null;
}

export interface ExtractedRoleSkills {
  languages?: string[] | null;
  actingEducation?: string | null;
}

export interface ExtractedRoleMeasurements {
  heightMin?: number | null;
  heightMax?: number | null;
  weightMin?: number | null;
  weightMax?: number | null;
  bust?: number | null;
  waist?: number | null;
  hips?: number | null;
}

export type ExtractedRole = ExtractedRoleBasic &
  ExtractedRoleAppearance &
  ExtractedRoleSkills &
  ExtractedRoleMeasurements;

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
  extractRoleBasic(text: string, roleName: string, prompt: string): Promise<ExtractedRoleBasic>;
  extractRoleAppearance(text: string, roleName: string, prompt: string): Promise<ExtractedRoleAppearance>;
  extractRoleSkills(text: string, roleName: string, prompt: string): Promise<ExtractedRoleSkills>;
  extractRoleMeasurements(text: string, roleName: string, prompt: string): Promise<ExtractedRoleMeasurements>;
  extractVacancy(text: string, vacancyName: string, prompt: string): Promise<ExtractedVacancy>;
}
