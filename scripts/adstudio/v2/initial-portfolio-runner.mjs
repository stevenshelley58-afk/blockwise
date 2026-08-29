#!/usr/bin/env node

// Build lane for the exact initial portfolio. Geometry, palettes, media
// counts, semantic inputs, and layer inventory come only from the data-only
// art-direction module; source candidates are provenance/evidence only.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { INITIAL_PORTFOLIO_IDS, initialPortfolioSpecs } from "./initial-portfolio-specs.mjs";

const root = resolve(process.cwd());
const arg = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};
if (process.argv.includes("--help")) {
  process.stdout.write("usage: initial-portfolio-runner.mjs --out <private-run-root> [--id <006|meta-feed-006> --source <private-source-path>]\n");
  process.exit(0);
}

const outValue = arg("--out");
const out = outValue ? resolve(outValue) : null;
const outFromRepo = out ? relative(root, out) : "";
if (!out || out === root || (!outFromRepo.startsWith("..") && !isAbsolute(outFromRepo))) {
  throw new Error("--out must point outside the committed builder checkout to this run's private assets root");
}
mkdirSync(out, { recursive: true });

const sources = {
  "180": "929ba683dba200ff6a0fde8684ffb465988f7314afc849849374543b2aae625f",
  "149": "110af622424bb8e0e5fb2f9d6ef1987c567e7e59482c86096b4a8d460efedf3b",
  "033": "c99bd8d9d5e9615c18932456f8285c3f6a47cbf4538a738d759f5592e89a0f90",
  "044": "5b3fe382b2b0dfe60f5d21f82671d66d423b4efe2bc4f1e98ab747acf1a5c873",
  "021": "e6b02d57ecd1ebafa04d7e017bb8deaebdcd67ca8aeeb0e55392792e9b3e484e",
  "006": "ca438800de425720d46b811f9fcf2b1f3c6aae8114f070308dee52cac424319e",
  "039": "46b06c29b8c652368f50eded9ebcd8a002b58c93f721c69ac8047a60ef82a342",
  "062": "e7ce1c928dd2710ff61fbea6c85aecf39f9d64b7d17815f00786266f4352b540",
  "154": "a6de2ddce0926887d61e9690a19bd0b7d8da7d7efa463b54ed651e62c62635cd",
  "108": "d3f25a649babf1ab4cf15d349b7bde0cc1515c655cc2485ba0b276e1372840e9",
  "111": "2d263dc76522e6195116d0b90ad6f384f02aac08fa22a2afc6ae3e5704a4e6e8",
  "182": "c846294f742bb137cc45e4648b5ec6f9b84872553f9f1335df73e72bb65f92db",
  "143": "5f21893f2a16edf613d9b2b1a12ca9c133f5199cb1f3e77b94dc2ede7a979ed5",
  "145": "a02d69ea0ad6472b5253927f7429bdeaf8920de9e3caad2fabb47a73ccc74cdd",
  "148": "dcd46a0f804a900ce38e176abb705b6cb27448782168fddee339c0f2f724fe31",
  "159": "6267d29cc07da5bbf5873f04b0adec787c86d7184f7377f5a770c1fbb3f6ddf8",
  "176": "67ed6da6697dd21398f40e8c724de844bb67056b02dda8916affcd2e2e6267ab",
  "194": "07bd424d942baa333370c6a8593ebefa228216a944b0c8822f65f7b6414531bc",
  "127": "d8251f5d22b924774d6c8e26b0c34b7468d3d07c45fb1248fc669f41f93b088b",
  "199": "2f0f173292ebd0c184a7d0543a8a36794ea15a1ca0c40ba219ff80dc0aebd8a0",
};

const fixtures = [
  "public/ads/ad-coastline.jpg", "public/ads/ad-hillco.jpg", "public/ads/ad-hillview.jpg", "public/ads/ad-northstar.jpg",
  "public/home/home-dusk.webp", "public/home/home-pool.webp", "public/home/interior-styled.webp", "public/home/mt-lawley-federation.webp",
  "public/home/open-home-living.webp", "public/home/subiaco-townhouse.webp", "public/adstudio-samples/photos/int-bedroom.png",
];
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sampleText = (spec) => Object.fromEntries((spec.inputs.text || []).map((input) => [input.key, input.sample || "EDITABLE DETAIL"]));
const runRecords = [];
const requestedId = arg("--id");
const requestedNumber = requestedId ? requestedId.replace(/^meta-feed-/, "").padStart(3, "0") : null;
const explicitSource = arg("--source");
if (requestedNumber && !INITIAL_PORTFOLIO_IDS.includes(requestedNumber)) {
  throw new Error(`--id must be one of the approved initial portfolio IDs; got ${requestedId}`);
}
if (requestedNumber && !explicitSource) {
  throw new Error("a single durable portfolio run requires --source <private-source-path>");
}
if (!requestedNumber && explicitSource) {
  throw new Error("--source is only valid with exactly one --id");
}
const selectedIds = requestedNumber ? [requestedNumber] : INITIAL_PORTFOLIO_IDS;

for (const number of selectedIds) {
  const index = INITIAL_PORTFOLIO_IDS.indexOf(number);
  const templateId = `meta-feed-${number}`;
  const source = explicitSource
    ? resolve(explicitSource)
    : join(root, "meta_ad_candidates", "01_feed_4x5_best", `meta_${number}.png`);
  if (!existsSync(source)) throw new Error(`${templateId}: source missing`);
  const sourceHash = sha256(readFileSync(source));
  if (sourceHash !== sources[number]) throw new Error(`${templateId}: source hash mismatch`);
  const spec = initialPortfolioSpecs[number];
  if (!spec) throw new Error(`${templateId}: missing data-only spec`);
  const text = sampleText(spec);
  const candidate = join(out, "candidates", templateId);
  mkdirSync(candidate, { recursive: true });
  const contract = {
    schema: "adstudio.variant-pack.contract.v1", mode: "single-template", templateId,
    packId: `meta-initial-${number}-${sourceHash.slice(0, 8)}`, name: `Blockwise ${spec.archetype}`,
    goal: "buyer_leads", offerId: "real-estate-consultation", category: "real-estate",
    tags: ["meta", "real-estate", "source-free", "initial-portfolio"], audienceIntent: "buyers",
    classification: { ad_type: "single_image", primary_intent: ["property_listing", "open_house", "market_education", "buyer_leads", "seller_leads"][index % 5], property_or_agent_focus: "property" },
    sourceAd: { file: `01_feed_4x5_best/meta_${number}.png`, contentHash: sourceHash },
    text: { brand_name: text.brand_name || "YOUR BRAND", headline: text.headline || "YOUR PROPERTY STORY", supporting: text.supporting || "EDITABLE SUPPORTING LINE", handle: text.contact || "YOUR CONTACT", arrow: ">" },
    semanticValues: text, portfolioSpec: spec, palette: spec.palette,
    copy: { primaryText: ["Discover a clearer next step for your property journey."], headlines: [text.headline || "YOUR PROPERTY STORY"], descriptions: ["Talk with a local property specialist."] },
    leadForm: { headline: "Start your property conversation", questions: ["What are you looking for?", "When are you hoping to move?"], thankYou: { title: "Thanks", body: "A local specialist will be in touch." } },
  };
  const contractPath = join(candidate, `${templateId}.contract.json`);
  writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
  const fixture = join(root, fixtures[index % fixtures.length]);
  const result = spawnSync(process.execPath, [join(root, "scripts/adstudio/v2/variant-pack.mjs"), "--contract", contractPath, "--repo", candidate, "--source", source, "--slot", fixture], { cwd: root, encoding: "utf8", timeout: 240_000 });
  if (result.status !== 0) throw new Error(`${templateId}: variant-pack failed\n${result.stdout}\n${result.stderr}`);
  runRecords.push({ templateId, packId: contract.packId, candidateRoot: candidate, variantManifest: join(candidate, "variant-pack.manifest.json"), sourceHash, status: "built" });
}

writeFileSync(join(out, "initial-portfolio-run.json"), `${JSON.stringify({ schema: "adstudio.initial-portfolio.run.v2", count: runRecords.length, requestedId: requestedNumber ? `meta-feed-${requestedNumber}` : null, sourceFree: true, nativePlacements: ["4:5", "9:16"], releaseStatus: "blocked_pending_human_approval", candidates: runRecords }, null, 2)}\n`);
process.stdout.write(JSON.stringify({ out, count: runRecords.length, candidates: runRecords }, null, 2));
