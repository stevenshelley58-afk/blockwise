import type { VideoAudience, VideoDraft, VideoHook, VideoObjective, VideoPresenter, VideoScene, VideoRecipe, VideoRecipeId } from "./types.ts";
import { videoRecipeSchema } from "./types.ts";

export const VIDEO_AUDIENCES: Array<{ value: VideoAudience; label: string; detail: string }> = [
  { value: "buyers", label: "People looking to buy", detail: "A new home, open house or listing" },
  { value: "sellers", label: "Homeowners thinking of selling", detail: "An appraisal, result or local proof point" },
  { value: "renters", label: "People looking to rent", detail: "A useful property or neighbourhood update" },
];

export const VIDEO_OBJECTIVES: Array<{ value: VideoObjective; label: string; detail: string }> = [
  { value: "new_listing", label: "Introduce a property", detail: "Make the first impression quickly" },
  { value: "appraisal", label: "Invite an appraisal", detail: "Turn local expertise into a conversation" },
  { value: "local_expertise", label: "Share a useful insight", detail: "Teach something your audience can act on" },
];

export const VIDEO_PRESENTERS: Array<{ value: VideoPresenter; label: string; detail: string }> = [
  { value: "agent", label: "I’ll be on camera", detail: "A simple talking-head or walk-through" },
  { value: "bookends", label: "I’ll open and close it", detail: "Your footage with a branded intro and ending" },
  { value: "no_camera", label: "No camera", detail: "Property imagery, captions and a voice-ready script" },
];

export const VIDEO_HOOKS: Array<{ value: VideoHook; label: string; detail: string }> = [
  { value: "new_here", label: "New to the market", detail: "Lead with what just changed" },
  { value: "question", label: "Start with a question", detail: "Open on the decision your audience is making" },
  { value: "proof", label: "Lead with proof", detail: "Start with a result, detail or local signal" },
];

const SCENE_LABELS: Array<{ kind: VideoScene["kind"]; title: string; assetLabel: string }> = [
  { kind: "hook", title: "Hook", assetLabel: "Opening image or presenter" },
  { kind: "proof", title: "Proof", assetLabel: "Property or local detail" },
  { kind: "value", title: "Value", assetLabel: "Useful takeaway" },
  { kind: "cta", title: "CTA", assetLabel: "Branded end card" },
];

export function buildVideoScenes(hook: VideoHook, objective: VideoObjective): VideoScene[] {
  const hookCopy = VIDEO_HOOKS.find((item) => item.value === hook)?.label ?? "A clear opening";
  const objectiveCopy = VIDEO_OBJECTIVES.find((item) => item.value === objective)?.label ?? "A useful next step";
  return SCENE_LABELS.map((scene, index) => ({
    id: `${scene.kind}-${index}`,
    kind: scene.kind,
    title: scene.title,
    assetLabel: scene.assetLabel,
    caption: scene.kind === "hook" ? hookCopy : scene.kind === "cta" ? objectiveCopy : scene.kind === "proof" ? "Show the detail that makes this worth watching." : "Give one useful reason to keep going.",
  }));
}

export function createVideoDraft(): VideoDraft {
  const audience = "buyers";
  const objective = "new_listing";
  const hook = "new_here";
  return { audience, objective, brief: "", presenter: "no_camera", hook, scenes: buildVideoScenes(hook, objective) };
}

const allRoutes: VideoRecipe["supportedProductionRoutes"] = ["presenter", "bookends", "no_camera"];
const beats = (purpose: string) => [
  { beat: "local hook", purpose: `Name the service area first. ${purpose}` },
  { beat: "context", purpose: "Explain one useful local point without pressure." },
  { beat: "proof or process", purpose: "Use only approved proof or a practical process." },
  { beat: "next step", purpose: "Make one clear lead-generation CTA." },
];

export const VIDEO_RECIPES: Record<VideoRecipeId, VideoRecipe> = {
  home_value: { id: "home_value", name: "Home value conversation", audience: "Local homeowners considering a move", durationSeconds: [15, 30], requiredAssets: ["logo"], optionalAssets: ["photo", "proof"], sceneBeats: beats("Invite a homeowner conversation."), supportedProductionRoutes: allRoutes, fallbackPolicy: "Use a no-camera explainer when footage is unavailable.", cta: "Request a local conversation", claimRequirements: ["Dated source for any market number.", "No unsupported valuation claim."] },
  sold_nearby: { id: "sold_nearby", name: "Sold nearby insight", audience: "Homeowners curious about local activity", durationSeconds: [15, 30], requiredAssets: ["logo", "proof"], optionalAssets: ["photo", "testimonial"], sceneBeats: beats("Share a verified local insight, not a listing."), supportedProductionRoutes: allRoutes, fallbackPolicy: "Use education when approved proof is missing.", cta: "Get the local insight", claimRequirements: ["Dated named source required.", "No listing-sale copy."] },
  qualified_buyer_demand: { id: "qualified_buyer_demand", name: "Qualified buyer demand", audience: "Homeowners weighing a sale", durationSeconds: [15, 30], requiredAssets: ["logo"], optionalAssets: ["proof", "testimonial"], sceneBeats: beats("Explain a qualification process without buyer counts."), supportedProductionRoutes: allRoutes, fallbackPolicy: "Use process education when demand proof is unavailable.", cta: "Talk through your options", claimRequirements: ["Buyer counts require dated proof.", "Never imply guaranteed buyers."] },
  suburb_pulse: { id: "suburb_pulse", name: "Suburb pulse", audience: "People wanting a concise local update", durationSeconds: [15, 30], requiredAssets: ["logo", "proof"], optionalAssets: ["photo"], sceneBeats: beats("Lead with a measured local signal."), supportedProductionRoutes: allRoutes, fallbackPolicy: "Remove numeric claims when proof is unavailable.", cta: "Ask for the local update", claimRequirements: ["Dated named source for signals.", "No forecast or guarantee."] },
  seller_education: { id: "seller_education", name: "Seller education checklist", audience: "Homeowners preparing for a future sale", durationSeconds: [15, 30], requiredAssets: ["logo"], optionalAssets: ["photo", "testimonial"], sceneBeats: beats("Share one practical preparation action."), supportedProductionRoutes: ["no_camera"], fallbackPolicy: "Default to no-camera educational content.", cta: "Get the seller checklist", claimRequirements: ["Educational tips only; no guarantees."] },
  testimonial_case_study: { id: "testimonial_case_study", name: "Testimonial or case study", audience: "Prospective clients seeking a local process", durationSeconds: [15, 30], requiredAssets: ["logo", "testimonial"], optionalAssets: ["photo", "proof"], sceneBeats: beats("Tell one consented client story."), supportedProductionRoutes: allRoutes, fallbackPolicy: "Use an approved quote card when a speaker is unavailable.", cta: "Start a local conversation", claimRequirements: ["Subject consent is required.", "Do not add unapproved outcomes."] },
  rental_appraisal: { id: "rental_appraisal", name: "Rental appraisal", audience: "Owners considering a rental review", durationSeconds: [15, 30], requiredAssets: ["logo"], optionalAssets: ["photo", "proof", "testimonial"], sceneBeats: beats("Explain a rental review without unsupported figures."), supportedProductionRoutes: allRoutes, fallbackPolicy: "Use a no-camera explainer without presenter footage.", cta: "Request a rental review", claimRequirements: ["No promised rent or return.", "Dated source for rental figures."] },
  pm_health_check: { id: "pm_health_check", name: "Property management health check", audience: "Owners reviewing property management", durationSeconds: [15, 30], requiredAssets: ["logo"], optionalAssets: ["photo", "testimonial"], sceneBeats: beats("Name a practical management question."), supportedProductionRoutes: ["no_camera"], fallbackPolicy: "Use factual, non-defamatory comparison education.", cta: "Book a management health check", claimRequirements: ["No guaranteed savings or performance."] },
};
for (const recipe of Object.values(VIDEO_RECIPES)) videoRecipeSchema.parse(recipe);
export function getVideoRecipe(id: VideoRecipeId): VideoRecipe { return VIDEO_RECIPES[id]; }
export function listVideoRecipes(): VideoRecipe[] { return Object.values(VIDEO_RECIPES); }
