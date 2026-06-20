// Pure mapping from an extracted CreativeSkeleton to a draft ad_template_candidates
// row for an operator sample import. No DB/network — unit-testable. The operator
// approves the draft through the existing template-library PATCH, after which it
// flows into v_ad_template_library and is pickable in Ad Studio with no Ad Studio
// code change (it already consumes image_frames).

import type { CreativeSkeleton, CreativeSkeletonArchetype } from "./skeleton.ts";

export const SAMPLE_IMPORT_SCORER_VERSION = "sample_import_v1";

const ALL_FORMATS = ["9:16", "4:5", "1:1"] as const;

export type SampleTemplateCandidateRow = {
  template_key: string;
  status: "draft";
  category: string;
  audience: string[];
  format: string[];
  hook_style: string;
  funnel_stage: string;
  adstudio_template_id: string;
  offer_id: string | null;
  goal: string | null;
  headline: string;
  primary_text: string | null;
  description: string | null;
  cta: string;
  variables: string[];
  evidence_score: number;
  creative_skeleton: CreativeSkeleton;
  scorer_version: string;
  winner_rationale: string;
  compliance_note: string;
};

export function buildSampleTemplateCandidate(input: {
  skeleton: CreativeSkeleton;
  templateKey: string;
}): SampleTemplateCandidateRow {
  const { skeleton } = input;
  return {
    template_key: input.templateKey,
    status: "draft",
    category: skeleton.archetype,
    audience: [],
    format: formatsForSkeleton(skeleton),
    hook_style: skeleton.copy.hook_style,
    funnel_stage: funnelStageForArchetype(skeleton.archetype),
    adstudio_template_id: input.templateKey,
    offer_id: null,
    goal: null,
    headline: skeleton.copy.headline_pattern,
    primary_text: null,
    description: null,
    cta: skeleton.copy.cta,
    variables: skeleton.variables,
    evidence_score: clampScore(skeleton.confidence),
    creative_skeleton: skeleton,
    scorer_version: SAMPLE_IMPORT_SCORER_VERSION,
    winner_rationale: "Operator sample import — template structure extracted from an uploaded sample creative.",
    compliance_note:
      "Sample-imported first-pass template. Avoid guaranteed values, guaranteed buyers, discriminatory targeting, or unsupported sale-result claims; placeholder values are variables, not real claims.",
  };
}

export function funnelStageForArchetype(archetype: CreativeSkeletonArchetype): string {
  switch (archetype) {
    case "appraisal":
      return "conversion";
    case "listing_hero":
    case "coming_soon":
      return "awareness";
    default:
      return "consideration";
  }
}

function formatsForSkeleton(skeleton: CreativeSkeleton): string[] {
  const declared = (skeleton.composition.image_frames ?? []).flatMap((frame) => frame.formats ?? []);
  const unique = Array.from(new Set(declared));
  return unique.length > 0 ? unique : [...ALL_FORMATS];
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value * 10) / 10));
}
