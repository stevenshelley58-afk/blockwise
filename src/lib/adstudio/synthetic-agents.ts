import type { createSupabaseServerClient } from "@/lib/supabase/server";
import type { ImageProviderAdapter } from "./providers.ts";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

export type AgentPersona = {
  personaKey: string;
  seed: number;
  gender: "female" | "male";
  ageRange: string;
  attire: string;
  setting: string;
};

// 12 fixed, diverse fictional AU agent personas.
// Seeds are stable — same seed → same appearance across carousel.
export const AGENT_PERSONAS: AgentPersona[] = [
  { personaKey: "f-35-professional-office",      seed: 1001, gender: "female", ageRange: "30–40", attire: "tailored blazer, white blouse", setting: "modern Perth real estate office interior, neutral tones" },
  { personaKey: "m-50-suit-suburban",             seed: 1002, gender: "male",   ageRange: "47–53", attire: "dark business suit, tie", setting: "bright suburban AU agency reception, timber floors" },
  { personaKey: "f-45-casual-outdoor",            seed: 1003, gender: "female", ageRange: "42–48", attire: "smart casual jacket, open collar", setting: "leafy Australian streetscape, eucalypt trees, midday sun" },
  { personaKey: "m-30-smartcasual-modern",        seed: 1004, gender: "male",   ageRange: "28–33", attire: "crisp shirt, no tie", setting: "contemporary glass-facade office lobby, natural light" },
  { personaKey: "f-55-formal-reception",          seed: 1005, gender: "female", ageRange: "52–58", attire: "formal charcoal suit", setting: "heritage AU building interior, warm lighting" },
  { personaKey: "m-40-blazer-perth",              seed: 1006, gender: "male",   ageRange: "37–43", attire: "navy blazer, open-collar shirt", setting: "clear blue Perth sky background, Colorbond-roofed homes" },
  { personaKey: "f-25-businesscasual-modern",     seed: 1007, gender: "female", ageRange: "23–27", attire: "business casual dress, blazer", setting: "bright modern co-working office, white and timber" },
  { personaKey: "m-60-formal-heritage",           seed: 1008, gender: "male",   ageRange: "57–63", attire: "classic wool suit", setting: "heritage brick AU office, bookshelf background" },
  { personaKey: "f-48-smart-residential",         seed: 1009, gender: "female", ageRange: "45–51", attire: "smart professional blazer, earrings", setting: "well-kept residential Australian street, brick letterbox" },
  { personaKey: "m-35-blazer-agencyoffice",       seed: 1010, gender: "male",   ageRange: "32–38", attire: "blazer over open-collar shirt", setting: "open-plan agency office, white walls, printed suburb maps" },
  { personaKey: "f-65-elegant-alfresco",          seed: 1011, gender: "female", ageRange: "62–67", attire: "elegant professional blazer", setting: "Australian alfresco garden, established plants, timber deck" },
  { personaKey: "m-55-business-regional",         seed: 1012, gender: "male",   ageRange: "52–58", attire: "business shirt, no tie", setting: "regional Australian landscape, gum trees, wide blue sky" },
];

// Returns a deterministic map from persona_key → persona for O(1) lookup.
export function agentPersonaByKey(): Map<string, AgentPersona> {
  return new Map(AGENT_PERSONAS.map((p) => [p.personaKey, p]));
}

// Builds the image prompt for a fictional AU agent portrait.
// Enforces: fictional, unnamed, clearly professional, AU context.
export function buildAgentPortraitPrompt(persona: AgentPersona): string {
  return [
    `Professional headshot photograph of a fictional Australian real estate agent.`,
    `${persona.gender === "female" ? "Woman" : "Man"}, approximately ${persona.ageRange} years old.`,
    `Wearing: ${persona.attire}.`,
    `Setting: ${persona.setting}.`,
    `Style: photoreal, editorial corporate headshot, shallow depth of field, natural Australian daylight.`,
    `The person is unnamed and fictional — not a real agent, not based on any specific individual.`,
    `Do not include: name badges, agency logos, phone numbers, or any text.`,
    `Clean copy-safe composition, subject fills the upper-center of frame.`,
    `Authentically Australian setting — no American real estate cues.`,
  ].join(" ");
}

export type GeneratePortraitResult = {
  assetUrl: string;
  personaKey: string;
  seed: number;
  model: string;
};

export async function generateSyntheticAgentPortrait(
  persona: AgentPersona,
  provider: ImageProviderAdapter,
): Promise<GeneratePortraitResult> {
  const result = await provider.generate({
    prompt: buildAgentPortraitPrompt(persona),
    negativePrompt:
      "Text, name badges, phone numbers, logos, blurry faces, distorted features, extra limbs, " +
      "US American realty signage, Americana, non-Australian setting.",
    referenceAssets: [],
    aspectRatio: "1:1",
    stylePreset: "professional_headshot",
    seed: persona.seed,
  });

  return {
    assetUrl: result.assetUrl,
    personaKey: persona.personaKey,
    seed: persona.seed,
    model: result.model,
  };
}

export type PersistSyntheticAgentInput = {
  persona: AgentPersona;
  portraitStoragePath: string;
  model: string;
};

export type PersistSyntheticAgentResult = {
  agentId: string;
  error: string | null;
};

export async function persistSyntheticAgent(
  supabase: SupabaseServerClient,
  input: PersistSyntheticAgentInput,
): Promise<PersistSyntheticAgentResult> {
  const { data, error } = await supabase
    .schema("research")
    .from("synthetic_agents")
    .upsert(
      {
        persona_key: input.persona.personaKey,
        seed: input.persona.seed,
        gender: input.persona.gender,
        age_range: input.persona.ageRange,
        attire: input.persona.attire,
        setting: input.persona.setting,
        portrait_storage_path: input.portraitStoragePath,
        is_synthetic: true,
        not_a_real_person: true,
        generated_at: new Date().toISOString(),
        metadata: { model: input.model },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "persona_key" },
    )
    .select("id")
    .single();

  if (error || !data) {
    return { agentId: "", error: error?.message ?? "Failed to persist synthetic agent." };
  }

  return { agentId: data.id, error: null };
}
