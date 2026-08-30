import { getVideoRecipe } from "./recipes.ts";
import { generateProviderVideoScript, type VideoProviderOptions } from "./provider.ts";
import { countWords, validateVideoScriptPlan, VideoValidationError } from "./validation.ts";
import type { ScenePlan, VideoProjectInput, VideoScriptPlan } from "./types.ts";

const PAD_WORDS = "with useful context tailored to your property and timing today".split(" ");

export async function generateVideoScript(
  input: VideoProjectInput,
  options: VideoProviderOptions = {},
): Promise<VideoScriptPlan> {
  const providerPlan = await generateProviderVideoScript(input, options);
  if (providerPlan) {
    try {
      return normalizeRenderedScenePlan(validateVideoScriptPlan(providerPlan, input), input);
    } catch {
      // A malformed provider answer is not customer copy. Continue through the
      // deterministic path, which is always bounded and policy checked.
    }
  }
  return generateDeterministicVideoScript(input);
}

export function generateDeterministicVideoScript(input: VideoProjectInput): VideoScriptPlan {
  const recipe = getVideoRecipe(input.recipeId);
  const area = input.brief.serviceArea;
  const cta = input.brief.cta ?? recipe.cta;
  const promise = "a clear local next step";
  const proof = input.brief.verifiedProof ? `Using verified local proof from ${input.brief.proofSource}.` : "We keep the conversation grounded in your situation.";
  const sceneAssets = buildSceneAssetIds(input);
  const scenes: ScenePlan[] = input.durationSeconds === 15
    ? [
      { index: 1, beat: recipe.sceneBeats[0].beat, narration: `In ${area}, what is your next property move?`, overlay: area, assetIds: sceneAssets[0] },
      { index: 2, beat: recipe.sceneBeats[1].beat, narration: "We explain local options clearly, without pressure.", overlay: "Practical local guidance", assetIds: sceneAssets[1] },
      { index: 3, beat: recipe.sceneBeats[2].beat, narration: "Grounded advice gives you a clear local next step.", overlay: input.brief.verifiedProof ? "Verified local insight" : "Grounded advice", assetIds: sceneAssets[2] },
      { index: 4, beat: recipe.sceneBeats[3].beat, narration: "Start a practical conversation for your goals.", overlay: cta, assetIds: sceneAssets[3] },
    ]
    : [
      { index: 1, beat: recipe.sceneBeats[0].beat, narration: `In ${area}, wondering what your next property move could look like?`, overlay: area, assetIds: sceneAssets[0] },
      { index: 2, beat: recipe.sceneBeats[1].beat, narration: "We explain the practical local signals and options in plain language, without pressure.", overlay: "Practical local guidance", assetIds: sceneAssets[1] },
      { index: 3, beat: recipe.sceneBeats[2].beat, narration: `${proof} You will leave with ${promise}.`, overlay: input.brief.verifiedProof ? "Verified local insight" : "Grounded advice", assetIds: sceneAssets[2] },
      { index: 4, beat: recipe.sceneBeats[3].beat, narration: "Start with one useful conversation tailored to your timing and goals.", overlay: cta, assetIds: sceneAssets[3] },
    ];

  const target = input.durationSeconds === 15 ? 35 : 68;
  const fixedWords = countWords(scenes.slice(0, 3).map((scene) => scene.narration).join(" ")) + countWords(cta);
  const desiredLastWords = target - fixedWords;
  scenes[3].narration = fitWords(scenes[3].narration, desiredLastWords);
  const body = scenes.map((scene) => scene.narration).join(" ");
  const plan: VideoScriptPlan = {
    version: 1,
    durationSeconds: input.durationSeconds,
    hookVariants: [
      { id: "hook_a", style: "question", text: `What could your next move look like in ${area}?` },
      { id: "hook_b", style: "proof", text: `A clearer local property conversation starts in ${area}.` },
      { id: "hook_c", style: "offer", text: `Get practical property guidance for ${area}.` },
    ],
    selectedHookId: "hook_a",
    body,
    cta,
    scenes,
    wordCount: countWords(`${body} ${cta}`),
    promise,
    source: "deterministic",
  };
  try {
    return normalizeRenderedScenePlan(validateVideoScriptPlan(plan, input), input);
  } catch (error) {
    if (error instanceof VideoValidationError) throw error;
    throw new VideoValidationError("The script could not be validated.");
  }
}

/** Ensure provider output and hook edits have a concrete render effect. */
export function normalizeRenderedScenePlan(plan: VideoScriptPlan, input: VideoProjectInput): VideoScriptPlan {
  const selectedHook = plan.hookVariants.find((hook) => hook.id === plan.selectedHookId);
  const allowed = new Set(input.assets.map((asset) => asset.id));
  const used = new Set<string>();
  const scenes = plan.scenes.map((scene) => ({
    ...scene,
    assetIds: scene.assetIds.filter((assetId) => {
      if (!allowed.has(assetId)) return false;
      if (used.has(assetId)) return false;
      used.add(assetId);
      return true;
    }),
  }));
  if (selectedHook) scenes[0] = { ...scenes[0], narration: selectedHook.text };
  const media = input.assets.filter((asset) => asset.kind === "photo" || asset.kind === "video");
  const proof = input.assets.filter((asset) => asset.kind === "proof" || asset.kind === "testimonial");
  const logo = input.assets.find((asset) => asset.kind === "logo");
  const candidates: Array<[number, VideoProjectInput["assets"][number] | undefined]> = [[0, media[0]], [1, media[1]], [2, proof[0] ?? media[2]], [3, logo]];
  for (const [index, asset] of candidates) {
    if (asset && !used.has(asset.id)) {
      scenes[index] = { ...scenes[index], assetIds: [...scenes[index].assetIds, asset.id] };
      used.add(asset.id);
    }
  }
  return { ...plan, scenes };
}

function buildSceneAssetIds(input: VideoProjectInput): [string[], string[], string[], string[]] {
  const used = new Set<string>();
  const take = (asset: VideoProjectInput["assets"][number] | undefined) => {
    if (!asset || used.has(asset.id)) return [];
    used.add(asset.id);
    return [asset.id];
  };
  const media = input.assets.filter((asset) => asset.kind === "photo" || asset.kind === "video");
  const proof = input.assets.filter((asset) => asset.kind === "proof" || asset.kind === "testimonial");
  const logo = input.assets.find((asset) => asset.kind === "logo");
  const sceneOne = take(media[0]);
  const sceneTwo = take(media[1]);
  const sceneThree = take(proof[0] ?? media[2]);
  const sceneFour = take(logo);
  return [sceneOne, sceneTwo, sceneThree, sceneFour];
}

function fitWords(text: string, desired: number): string {
  const words = text.trim().split(/\s+/u);
  if (desired <= 0) throw new VideoValidationError("The CTA leaves no room for the final scene.");
  if (words.length > desired) return words.slice(0, desired).join(" ").replace(/[,:;]$/u, "") + ".";
  const output = [...words];
  let cursor = 0;
  while (output.length < desired) output.push(PAD_WORDS[cursor++ % PAD_WORDS.length]);
  return output.join(" ").replace(/[,:;]$/u, "") + ".";
}
