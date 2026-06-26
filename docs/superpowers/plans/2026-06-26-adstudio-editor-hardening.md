# Ad Studio Editor Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the existing Blockwise Ad Studio editor so approved templates reach the picker, selected templates resolve server-side, Fabric edits persist through draft/reload/export, and the current Canva-like scope stays Blockwise-native.

**Architecture:** Keep the constrained Ad Studio model: approved `AdStudioTemplate` records drive template choice, `FabricAdEditor` remains the desktop canvas editor, and exports render from canonical `AdStudioCanvasObject` data after lossless projection from Fabric. Do not import a generic Canva clone or resurrect deleted repair endpoints.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase service client, Fabric.js 7, Node test runner, Playwright against Vercel Preview/Production.

---

## Context Reviewed

- Thread `019f01be-ffec-72a3-9a7a-973aa3883b79` has the template media/text contract work live on `feat/audit-intel-report`; the first checkpoint promoted `meta_002`, `meta_021`, `meta_040`, `meta_044`, and `meta_055` to production.
- Thread `019f02b4-5b29-7b83-a20e-d0fb8bcd88a9` scoped the clearer "Generate ad" missing-info prompt. Current source still renders submit errors as a small footer string in `src/components/adstudio/new-ad-dialog.tsx`, so this plan includes that as a small UI hardening task unless another branch merges it first.
- Current source confirms the review's main technical findings:
  - `src/lib/adstudio/templates.ts` maps approved DB rows but `mergeAdStudioTemplateLibrary()` ignores them.
  - `src/lib/adstudio/template-resolver.ts` rejects every non-built-in template.
  - `src/components/adstudio/use-campaign-actions.ts` strips `canvas.fabricJson` before draft/export paths.
  - `src/components/adstudio/canvas/browser-creative-renderer.ts` exports from `creative.canvas.objects`, not Fabric JSON.
  - Desktop uses `FabricAdEditor`; mobile media/text uses `AdPreview`.
  - `src/app/api/adstudio/repair-image/route.ts` is intentionally deleted. `tests/adstudio-real-loop-regressions.test.ts` asserts it stays deleted.

## Non-Goals

- Do not clone `open-design`, `canva-clone`, Polotno, or any generic editor.
- Do not add arbitrary "add anything" design primitives: no generic layer panel, sticker library, multipage design surface, or full object inspector.
- Do not reintroduce `/api/adstudio/repair-image` or `/api/adstudio/generate-image`.
- Do not make mobile WYSIWYG parity part of the first hardening PR. Mobile can remain preview plus panels until desktop save/export correctness is proven.

## File Structure

- Modify `src/lib/adstudio/templates.ts`
  - Owns DB row mapping, safe template metadata, built-in template defaults, and merged picker output.
- Modify `src/app/api/adstudio/template-library/route.ts`
  - Loads approved rows from `research.v_ad_template_library` and returns the merged picker list.
- Modify `src/lib/adstudio/template-resolver.ts`
  - Resolves either a built-in template or an exact approved DB template for generation/photo prep.
- Modify `src/app/api/adstudio/campaigns/route.ts`
  - Keeps first-ad validation and consumes resolver output. Only copy changes are expected here unless resolver signature changes.
- Modify `src/app/api/adstudio/template-photo-prep/route.ts`
  - Uses the same approved-template resolution path as campaign creation.
- Modify `src/lib/adstudio/types.ts`
  - Adds image placement metadata to `AdStudioCanvasObject` if Fabric crop/export parity requires it.
- Modify `src/lib/adstudio/creative-design-json.ts`
  - Converts Fabric JSON into canonical canvas objects without losing frame, crop, text, or image source state.
- Modify `src/lib/adstudio/creative-design-builder.ts`
  - Emits Fabric design JSON with enough metadata to reconstruct image frame and placement.
- Modify `src/components/adstudio/canvas/fabric-ad-editor.tsx`
  - Reads/writes Fabric JSON, image frames, crop placement, and editor metadata.
- Modify `src/components/adstudio/canvas/browser-creative-renderer.ts`
  - Renders images from canonical frame plus placement data.
- Modify `src/lib/adstudio/renderer.ts`
  - Keeps SVG preview/export fallback aligned with image frame plus placement data.
- Modify `src/components/adstudio/use-campaign-actions.ts`
  - Stops dropping `fabricJson` before draft persistence and before browser export rendering.
- Modify `src/components/adstudio/new-ad-dialog.tsx`
  - Makes missing description/image/upload errors obvious and accessible.
- Test files to add or update:
  - `tests/adstudio-template-library-order.test.ts`
  - `tests/adstudio-template-resolver.test.ts`
  - `tests/adstudio-real-loop-regressions.test.ts`
  - `tests/adstudio-creative-design-json.test.ts`
  - `tests/adstudio-mobile-flow.test.ts`
  - `e2e/adstudio-real-loop.spec.ts`

## Implementation Tasks

### Task 1: Baseline And Guard Rails

**Files:**
- Read: `docs/superpowers/plans/2026-06-26-adstudio-editor-hardening.md`
- Read: `AGENTS.md`
- Read: `hermes/skills/blockwise-agent-cleanup/SKILL.md`

- [ ] **Step 1: Confirm repository state**

Run:

```powershell
git status --short --branch
codegraph status
```

Expected:
- Current branch is known before edits.
- CodeGraph is up to date or synced before code exploration.
- Any dirty files are listed and classified before touching them.

- [ ] **Step 2: Create a checkpoint commit boundary if needed**

If the branch already has unrelated dirty files, do not edit them. If the branch is clean, continue.

Run:

```powershell
git diff --name-only
git ls-files --others --exclude-standard
```

Expected:
- No unrelated dirty files are included in later `git add` commands.

- [ ] **Step 3: Confirm no external editor import**

Run:

```powershell
rg -n "polotno|canva-clone|open-design|grapesjs|konva" package.json src tests
```

Expected:
- No new generic editor dependency is present.
- Existing `fabric` dependency remains the editor foundation.

Commit:

```powershell
git status --short
```

Expected:
- No commit for this task unless a sync-only metadata change was required.

### Task 2: Merge Approved Template Library Rows Into The Picker

**Files:**
- Modify: `src/lib/adstudio/templates.ts`
- Modify: `src/app/api/adstudio/template-library/route.ts`
- Test: `tests/adstudio-template-library-order.test.ts`

- [ ] **Step 1: Write failing tests for approved DB templates appearing**

In `tests/adstudio-template-library-order.test.ts`, replace the "only exposes quality-gated gold templates" expectation with tests that prove the merged picker contains built-ins plus approved DB templates, while built-ins win duplicate keys.

Add this test shape:

```typescript
test("template library merges approved DB templates after visible built-ins", () => {
  const approved = [
    row({
      template_key: "radar-approved-001",
      category: "appraisal",
      headline: "Find out what {{suburb}} buyers notice first",
      primary_text: "Book a practical local price update before you decide.",
      description: "Local price update",
      cta: "Book appraisal",
      evidence_score: 91,
      sample_card_image_path: "adstudio-samples/v1/radar-approved-001.png",
      template_designs: {
        "4:5": {
          templateId: "radar-approved-001",
          version: 1,
          format: "4:5",
          canvas: { w: 1080, h: 1350 },
          palette: ["#14314F", "#FFFFFF"],
          fonts: ["Inter"],
          layers: [
            { id: "background", type: "shape", rect: { x: 0, y: 0, w: 1, h: 1 }, fill: "#14314F", role: "background", locked: true },
            { id: "primary_photo", type: "image_slot", role: "primary", rect: { x: 0.05, y: 0.05, w: 0.9, h: 0.58 }, fit: "cover", mask: "none" },
            { id: "headline", type: "text", rect: { x: 0.08, y: 0.68, w: 0.84, h: 0.12 }, slot: "headline", align: "left", font: "Inter", size: 52, lineHeight: 1.05, weight: 850, color: "#FFFFFF", fill: "ai_copy", maxChars: 54, maxLines: 2 },
          ],
        },
      },
    }),
  ]
    .map((template) => mapAdStudioLibraryTemplate(template))
    .filter((template) => template !== null);

  const merged = mergeAdStudioTemplateLibrary(approved);

  assert.deepEqual(merged.slice(0, visibleGoldTemplateIds.length).map((template) => template.id), visibleGoldTemplateIds);
  const approvedTemplate = merged.find((template) => template.id === "radar-approved-001");
  assert.ok(approvedTemplate);
  assert.equal(approvedTemplate.source, "radar");
  assert.equal(approvedTemplate.evidenceScore, 91);
  assert.ok(approvedTemplate.designs?.["4:5"]);
});
```

Add a duplicate-key test:

```typescript
test("built-in templates win duplicate approved DB keys", () => {
  const approved = [
    row({ template_key: visibleGoldTemplateIds[0], evidence_score: 99 }),
  ]
    .map((template) => mapAdStudioLibraryTemplate(template))
    .filter((template) => template !== null);

  const merged = mergeAdStudioTemplateLibrary(approved);

  assert.equal(merged.filter((template) => template.id === visibleGoldTemplateIds[0]).length, 1);
  assert.equal(merged.find((template) => template.id === visibleGoldTemplateIds[0])?.source, "builtin");
});
```

Run:

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/adstudio-template-library-order.test.ts
```

Expected:
- Fails because `mergeAdStudioTemplateLibrary()` currently ignores approved rows.

- [ ] **Step 2: Extract the template-library select list**

In `src/lib/adstudio/templates.ts`, add a shared constant so the route and resolver use the same columns:

```typescript
export const ADSTUDIO_TEMPLATE_LIBRARY_SELECT =
  "template_key,status,category,hook_style,funnel_stage,adstudio_template_id,offer_id,goal,headline,primary_text,description,cta,image_brief_id,sample_card_image_path,sample_style,ai_prompt_seed,creative_skeleton,template_designs,template_version,brief_schema,exemplar_observed_ad_ids,evidence_score,winner_rationale,compliance_note";
```

In `src/app/api/adstudio/template-library/route.ts`, replace the string passed to `.select(...)` with `ADSTUDIO_TEMPLATE_LIBRARY_SELECT`.

- [ ] **Step 3: Implement deterministic merge with built-in precedence**

In `src/lib/adstudio/templates.ts`, replace the current merge function:

```typescript
export function mergeAdStudioTemplateLibrary(approved: AdStudioTemplate[]): AdStudioTemplate[] {
  const merged: AdStudioTemplate[] = [];
  const seen = new Set<string>();

  const add = (template: AdStudioTemplate) => {
    const normalised = withTemplateDefaults(template);
    const key = templateIdentity(normalised);
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(normalised);
  };

  for (const template of builtInAdStudioTemplates()) add(template);
  for (const template of approved.filter(isVisibleApprovedLibraryTemplate)) add(template);

  return merged;
}

function templateIdentity(template: AdStudioTemplate): string {
  return (template.templateKey ?? template.id).trim();
}

function isVisibleApprovedLibraryTemplate(template: AdStudioTemplate): boolean {
  if ((template.status ?? "approved") !== "approved") return false;
  if (template.source !== "operator" && template.source !== "radar") return false;
  if (!templateIdentity(template)) return false;
  return Boolean(template.designs || template.creativeSkeleton);
}
```

If tests reveal that approved rows without `designs` but with `creativeSkeleton` are too broad, tighten `isVisibleApprovedLibraryTemplate()` to require `template.designs` and update `mapAdStudioLibraryTemplate()` so only rows with parsed `template_designs` become customer-visible.

- [ ] **Step 4: Keep draft and archived rows excluded**

Add tests:

```typescript
test("template library excludes draft and archived rows from customer picker", () => {
  const mapped = [
    row({ template_key: "draft-template", status: "draft" }),
    row({ template_key: "archived-template", status: "archived" }),
  ]
    .map((template) => mapAdStudioLibraryTemplate(template))
    .filter((template) => template !== null);

  assert.deepEqual(mapped, []);
});
```

Run:

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/adstudio-template-library-order.test.ts
```

Expected:
- Template library tests pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/lib/adstudio/templates.ts src/app/api/adstudio/template-library/route.ts tests/adstudio-template-library-order.test.ts
git commit -m "fix: merge approved ad studio templates"
```

### Task 3: Resolve DB-Approved Templates Server-Side

**Files:**
- Modify: `src/lib/adstudio/template-resolver.ts`
- Modify: `src/app/api/adstudio/campaigns/route.ts`
- Modify: `src/app/api/adstudio/template-photo-prep/route.ts`
- Test: `tests/adstudio-template-resolver.test.ts`
- Test: `tests/adstudio-real-loop-regressions.test.ts`

- [ ] **Step 1: Add resolver unit tests before implementation**

Create `tests/adstudio-template-resolver.test.ts`:

```typescript
import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveApprovedAdStudioTemplate,
  type AdStudioTemplate,
} from "../src/lib/adstudio/index.ts";

const approvedTemplate: AdStudioTemplate = {
  id: "radar-approved-001",
  templateKey: "radar-approved-001",
  name: "Approved radar layout",
  goal: "appraisal_bookings",
  offerId: "home_value_update",
  promptHint: "Approved radar layout for local appraisal leads.",
  source: "radar",
  status: "approved",
  designs: {
    "4:5": {
      templateId: "radar-approved-001",
      version: 1,
      format: "4:5",
      canvas: { w: 1080, h: 1350 },
      palette: ["#14314F", "#FFFFFF"],
      fonts: ["Inter"],
      layers: [
        { id: "background", type: "shape", rect: { x: 0, y: 0, w: 1, h: 1 }, fill: "#14314F", role: "background", locked: true },
        { id: "primary_photo", type: "image_slot", role: "primary", rect: { x: 0.05, y: 0.05, w: 0.9, h: 0.58 }, fit: "cover", mask: "none" },
      ],
    },
  },
};

test("resolveApprovedAdStudioTemplate resolves built-in templates", async () => {
  const template = await resolveApprovedAdStudioTemplate({ templateKey: "meta_002" });
  assert.equal(template.id, "meta_002");
  assert.equal(template.status, "approved");
});

test("resolveApprovedAdStudioTemplate resolves exact approved DB templates", async () => {
  const template = await resolveApprovedAdStudioTemplate(
    { templateKey: "radar-approved-001" },
    { lookupApprovedTemplate: async () => approvedTemplate },
  );
  assert.equal(template.id, "radar-approved-001");
  assert.equal(template.source, "radar");
});

test("resolveApprovedAdStudioTemplate rejects arbitrary template keys", async () => {
  await assert.rejects(
    () => resolveApprovedAdStudioTemplate(
      { templateKey: "not-approved" },
      { lookupApprovedTemplate: async () => null },
    ),
    /not found or is not approved/i,
  );
});
```

Run:

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/adstudio-template-resolver.test.ts
```

Expected:
- Fails because resolver has no injectable DB lookup and rejects non-built-ins.

- [ ] **Step 2: Add an injectable lookup option**

In `src/lib/adstudio/template-resolver.ts`, change the resolver signature to:

```typescript
type ResolveApprovedTemplateOptions = {
  lookupApprovedTemplate?: (key: string) => Promise<AdStudioTemplate | null>;
};

export async function resolveApprovedAdStudioTemplate(
  input: {
    templateKey?: string | null;
    templateId?: string | null;
  },
  options: ResolveApprovedTemplateOptions = {},
): Promise<AdStudioTemplate> {
  const key = cleanTemplateKey(input.templateKey) ?? cleanTemplateKey(input.templateId);
  if (!key) throw new Error("Selected template was not found.");

  const builtIn = resolveBuiltInApprovedTemplate(key);
  if (builtIn) return builtIn;

  const approved = await (options.lookupApprovedTemplate ?? lookupApprovedLibraryTemplate)(key);
  if (!approved || approved.status !== "approved") {
    throw new Error("Selected template was not found or is not approved.");
  }
  return approved;
}
```

Change `resolveBuiltInApprovedTemplate()` so it returns `AdStudioTemplate | null` instead of throwing.

- [ ] **Step 3: Implement exact DB lookup**

Still in `src/lib/adstudio/template-resolver.ts`, add a service-client lookup:

```typescript
async function lookupApprovedLibraryTemplate(key: string): Promise<AdStudioTemplate | null> {
  let research: ReturnType<typeof createSupabaseServiceClient>;
  try {
    research = createSupabaseServiceClient().schema("research");
  } catch {
    return null;
  }

  const { data, error } = await research
    .from("v_ad_template_library")
    .select(ADSTUDIO_TEMPLATE_LIBRARY_SELECT)
    .eq("template_key", key)
    .eq("status", "approved")
    .maybeSingle();

  if (isMissingTemplateLibrary(error)) return null;
  if (error) throw new Error(error.message);
  return data ? mapAdStudioLibraryTemplate(data as AdStudioLibraryTemplate) : null;
}
```

Add imports:

```typescript
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import {
  ADSTUDIO_TEMPLATE_LIBRARY_SELECT,
  builtInAdStudioTemplates,
  mapAdStudioLibraryTemplate,
  type AdStudioLibraryTemplate,
  type AdStudioTemplate,
} from "./templates.ts";
```

- [ ] **Step 4: Verify campaign and photo-prep routes still use resolver**

In `tests/adstudio-real-loop-regressions.test.ts`, keep these assertions and add one for the template photo prep route:

```typescript
const photoPrepRoute = readFileSync("src/app/api/adstudio/template-photo-prep/route.ts", "utf8");
assert.match(createRoute, /resolveApprovedAdStudioTemplate/);
assert.match(photoPrepRoute, /resolveApprovedAdStudioTemplate/);
assert.doesNotMatch(createRoute, /AD_STUDIO_TEMPLATES\.some/);
```

Run:

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/adstudio-template-resolver.test.ts tests/adstudio-real-loop-regressions.test.ts
```

Expected:
- Resolver tests pass.
- Real-loop regression tests pass.

- [ ] **Step 5: Commit**

Run:

```powershell
git add src/lib/adstudio/template-resolver.ts src/app/api/adstudio/campaigns/route.ts src/app/api/adstudio/template-photo-prep/route.ts tests/adstudio-template-resolver.test.ts tests/adstudio-real-loop-regressions.test.ts
git commit -m "fix: resolve approved ad studio templates"
```

### Task 4: Keep The New Ad Missing-Info Error Obvious

**Files:**
- Modify: `src/components/adstudio/new-ad-dialog.tsx`
- Test: `tests/adstudio-real-loop-regressions.test.ts`

- [ ] **Step 1: Add static regression assertions for alert semantics**

In `tests/adstudio-real-loop-regressions.test.ts`, add:

```typescript
test("New Ad dialog shows missing generate requirements as a prominent alert", () => {
  const dialog = readFileSync("src/components/adstudio/new-ad-dialog.tsx", "utf8");

  assert.match(dialog, /role="alert"/);
  assert.match(dialog, /aria-live="assertive"/);
  assert.match(dialog, /Add the missing details before generating/);
  assert.match(dialog, /Add a short description so Blockwise knows what to write/);
  assert.match(dialog, /Add required images:/);
  assert.doesNotMatch(dialog, /setError\("Add a short description\."\)/);
});
```

Run:

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/adstudio-real-loop-regressions.test.ts
```

Expected:
- Fails against the current small footer error.

- [ ] **Step 2: Replace the string error with structured blockers**

In `src/components/adstudio/new-ad-dialog.tsx`, add:

```typescript
type GenerateBlocker = {
  id: "uploading" | "images" | "description" | "description_length";
  message: string;
};

function buildGenerateBlockers(input: {
  uploadingImage: boolean;
  missingRequiredImageSlots: TemplateMediaSlot[];
  description: string;
}): GenerateBlocker[] {
  const trimmed = input.description.trim();
  const blockers: GenerateBlocker[] = [];
  if (input.uploadingImage) {
    blockers.push({ id: "uploading", message: "Image upload is still running. Wait for it to finish, then generate the ad." });
  }
  if (input.missingRequiredImageSlots.length > 0) {
    blockers.push({
      id: "images",
      message: `Add required images: ${input.missingRequiredImageSlots.map((slot) => slot.label).join(", ")}. Upload files, choose from library, or generate images for the missing slots.`,
    });
  }
  if (!trimmed) {
    blockers.push({
      id: "description",
      message: "Add a short description so Blockwise knows what to write. Include the property, suburb, offer, or key selling point.",
    });
  }
  if (trimmed.length > 500) {
    blockers.push({ id: "description_length", message: "Keep the description under 500 characters." });
  }
  return blockers;
}
```

Use state:

```typescript
const [generateBlockers, setGenerateBlockers] = useState<GenerateBlocker[]>([]);
```

In `submit()`, replace early `setError(...)` returns with:

```typescript
const blockers = buildGenerateBlockers({ uploadingImage, missingRequiredImageSlots, description });
if (blockers.length > 0) {
  setGenerateBlockers(blockers);
  setError("");
  const firstMissingImage = missingRequiredImageSlots[0];
  if (firstMissingImage) setActiveMediaSlotId(firstMissingImage.id);
  return;
}
```

Clear blockers on successful image selection, description changes, mode changes, and successful submit.

- [ ] **Step 3: Render the prominent alert**

Above `.studio-newad-foot`, render:

```tsx
{generateBlockers.length > 0 && (
  <div className="studio-newad-requirements-alert" role="alert" aria-live="assertive">
    <strong>Add the missing details before generating</strong>
    <ul>
      {generateBlockers.map((blocker) => (
        <li key={blocker.id}>{blocker.message}</li>
      ))}
    </ul>
  </div>
)}
```

Add CSS inside `EXPLORE_STYLES`:

```css
.studio-newad-requirements-alert{margin:0 22px 16px;border:1px solid #f2b8a0;border-radius:10px;background:#fff4ed;color:#7a271a;padding:14px 16px;display:grid;gap:8px;font-size:13.5px;line-height:1.45}
.studio-newad-requirements-alert strong{font-size:14.5px;color:#7a271a}
.studio-newad-requirements-alert ul{margin:0;padding-left:18px;display:grid;gap:4px}
```

- [ ] **Step 4: Verify and commit**

Run:

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/adstudio-real-loop-regressions.test.ts
git add src/components/adstudio/new-ad-dialog.tsx tests/adstudio-real-loop-regressions.test.ts
git commit -m "fix: show clear ad generation requirements"
```

### Task 5: Write Fabric Projection Tests Before Fixing Persistence

**Files:**
- Create: `tests/adstudio-creative-design-json.test.ts`
- Read: `src/lib/adstudio/creative-design-json.ts`
- Read: `src/lib/adstudio/creative-design-builder.ts`

- [ ] **Step 1: Create fixture helpers**

Create `tests/adstudio-creative-design-json.test.ts` with:

```typescript
import assert from "node:assert/strict";
import test from "node:test";

import { buildCreativeDesignJson } from "../src/lib/adstudio/creative-design-builder.ts";
import {
  BLOCKWISE_FABRIC_META_KEY,
  saveCreativeDesignJson,
  type CreativeCopyFields,
} from "../src/lib/adstudio/creative-design-json.ts";
import { generateAdStudioCampaignPack } from "../src/lib/adstudio/index.ts";
import type { AdStudioBrandKit } from "../src/lib/adstudio/types.ts";

const brandKit: AdStudioBrandKit = {
  brandKitId: "brand_test",
  workspaceId: "workspace_test",
  source: { type: "manual", url: "https://example.com", lastExtractedAt: "2026-06-26T00:00:00.000Z", pagesScanned: [] },
  identity: { businessName: "Realty Plus", tradingName: "Realty Plus", marketCountry: "AU", marketRegion: "WA", licenceText: null },
  logos: { primaryLogoUrl: null, darkLogoUrl: null, lightLogoUrl: null, faviconUrl: null },
  colours: { primary: "#14314F", secondary: "#D9E7E3", accent: "#E7B24B", background: "#FFFFFF", text: "#101828", confidence: { primary: 1, secondary: 1 } },
  typography: { headingFont: "Inter", bodyFont: "Inter", fallbackHeading: "sans-serif", fallbackBody: "sans-serif" },
  visualStyle: { styleTags: [], imageTreatment: "natural", layoutDensity: "medium", cornerRadius: "medium" },
  tone: { voice: "clear", avoid: [], preferredPhrases: [], sampleCopy: [] },
  assets: { headshots: [], officeImages: [], listingImages: [], socialProofImages: [] },
  contact: { phone: null, email: null, address: null, socialLinks: [] },
  compliance: { disclaimers: [], privacyPolicyUrl: null, termsUrl: null },
  reviewStatus: "approved",
  lockedFields: [],
};

const copy: CreativeCopyFields = {
  headline: "Scarborough open home",
  description: "A renovated family home close to the coast.",
  cta: "Learn more",
};

function creativeFixture() {
  const pack = generateAdStudioCampaignPack({
    workspaceId: "workspace_test",
    brandKit,
    goal: "seller_leads",
    suburb: "Scarborough",
    city: "Perth",
    state: "WA",
    offerId: "seller_prep_checklist",
    platforms: ["meta"],
    variantCount: 1,
    sourceImageDataUrl: "/api/adstudio/media?path=workspace_test%2Flisting.jpg",
  });
  const creative = pack.creatives.find((item) => item.format === "4:5") ?? pack.creatives[0];
  assert.ok(creative);
  return creative;
}
```

- [ ] **Step 2: Test moved/resized text projection**

Add:

```typescript
test("saveCreativeDesignJson projects moved and resized text into canvas objects", () => {
  const creative = creativeFixture();
  const design = buildCreativeDesignJson({ creative, brandKit, copy, imageSrc: "/api/adstudio/media?path=workspace_test%2Flisting.jpg" });
  const headline = design.objects.find((object) => object[BLOCKWISE_FABRIC_META_KEY]?.role === "headline");
  assert.ok(headline);

  const saved = saveCreativeDesignJson(creative, {
    ...design,
    objects: design.objects.map((object) =>
      object === headline
        ? { ...object, left: 123, top: 456, width: 380, height: 118, fontSize: 44, text: "Moved headline" }
        : object,
    ),
  });
  const projected = saved.canvas.objects.find((object) => object.objectId === headline[BLOCKWISE_FABRIC_META_KEY]?.objectId);

  assert.equal(projected?.x, 123);
  assert.equal(projected?.y, 456);
  assert.equal(projected?.width, 380);
  assert.equal(projected?.height, 118);
  assert.equal(projected?.size, 44);
  assert.equal(projected?.content, "Moved headline");
  assert.ok(saved.canvas.fabricJson);
});
```

- [ ] **Step 3: Test image frame and placement projection**

Add the failing test that exposes the current image-frame/crop gap:

```typescript
test("saveCreativeDesignJson keeps image frame separate from fitted image placement", () => {
  const creative = creativeFixture();
  const design = buildCreativeDesignJson({ creative, brandKit, copy, imageSrc: "/api/adstudio/media?path=workspace_test%2Flisting.jpg" });
  const image = design.objects.find((object) => object[BLOCKWISE_FABRIC_META_KEY]?.role === "primary_image");
  assert.ok(image);

  const saved = saveCreativeDesignJson(creative, {
    ...design,
    objects: design.objects.map((object) =>
      object === image
        ? {
            ...object,
            src: "/api/adstudio/media?path=workspace_test%2Freplacement.jpg",
            left: -40,
            top: 24,
            width: 900,
            height: 600,
            scaleX: 1.5,
            scaleY: 1.5,
            clipPath: { left: 80, top: 120, width: 540, height: 420, scaleX: 1, scaleY: 1 },
          }
        : object,
    ),
  });
  const projected = saved.canvas.objects.find((object) => object.objectId === image[BLOCKWISE_FABRIC_META_KEY]?.objectId);

  assert.equal(projected?.x, 80);
  assert.equal(projected?.y, 120);
  assert.equal(projected?.width, 540);
  assert.equal(projected?.height, 420);
  assert.equal(projected?.content, "/api/adstudio/media?path=workspace_test%2Freplacement.jpg");
  assert.deepEqual(projected?.imagePlacement, { x: -40, y: 24, width: 1350, height: 900 });
});
```

Run:

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/adstudio-creative-design-json.test.ts
```

Expected:
- Text test may pass.
- Image placement test fails until Task 6 adds placement support.

### Task 6: Preserve Fabric JSON And Image Placement Through Draft/Export

**Files:**
- Modify: `src/lib/adstudio/types.ts`
- Modify: `src/lib/adstudio/creative-design-json.ts`
- Modify: `src/lib/adstudio/creative-design-builder.ts`
- Modify: `src/components/adstudio/canvas/fabric-ad-editor.tsx`
- Modify: `src/components/adstudio/canvas/browser-creative-renderer.ts`
- Modify: `src/lib/adstudio/renderer.ts`
- Modify: `src/components/adstudio/use-campaign-actions.ts`
- Test: `tests/adstudio-creative-design-json.test.ts`
- Test: `tests/adstudio-real-loop-regressions.test.ts`

- [ ] **Step 1: Add image placement to the canonical canvas object type**

In `src/lib/adstudio/types.ts`, extend `AdStudioCanvasObject`:

```typescript
imagePlacement?: {
  x: number;
  y: number;
  width: number;
  height: number;
};
```

This stores the actual fitted image draw box in canvas coordinates. The existing `x`, `y`, `width`, and `height` continue to mean the visible frame.

- [ ] **Step 2: Extend design JSON typing for Fabric clip path**

In `src/lib/adstudio/creative-design-json.ts`, extend `CreativeDesignObjectJson`:

```typescript
clipPath?: {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  scaleX?: number;
  scaleY?: number;
};
```

- [ ] **Step 3: Project image frame from clip path and placement from Fabric object**

In `src/lib/adstudio/creative-design-json.ts`, add helpers:

```typescript
function frameFromDesignObject(
  object: CreativeDesignObjectJson,
  fallback: AdStudioCanvasObject,
): Pick<AdStudioCanvasObject, "x" | "y" | "width" | "height"> {
  const clip = object.clipPath;
  if (clip && typeof clip === "object") {
    const width = Math.round(numberOr(clip.width, fallback.width) * numberOr(clip.scaleX, 1));
    const heightValue = numberOr(clip.height, fallback.height ?? fallback.width);
    return {
      x: Math.round(numberOr(clip.left, fallback.x)),
      y: Math.round(numberOr(clip.top, fallback.y)),
      width,
      height: Math.round(heightValue * numberOr(clip.scaleY, 1)),
    };
  }
  return {
    x: Math.round(numberOr(object.left, fallback.x)),
    y: Math.round(numberOr(object.top, fallback.y)),
    width: Math.round(numberOr(object.width, fallback.width) * numberOr(object.scaleX, 1)),
    height: object.height === undefined ? fallback.height : Math.round(numberOr(object.height, fallback.height ?? fallback.width) * numberOr(object.scaleY, 1)),
  };
}

function imagePlacementFromDesignObject(object: CreativeDesignObjectJson): AdStudioCanvasObject["imagePlacement"] {
  const left = numberOr(object.left, undefined);
  const top = numberOr(object.top, undefined);
  const width = numberOr(object.width, undefined);
  const height = numberOr(object.height, undefined);
  if (left === undefined || top === undefined || width === undefined || height === undefined) return undefined;
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(width * numberOr(object.scaleX, 1)),
    height: Math.round(height * numberOr(object.scaleY, 1)),
  };
}
```

Update `objectFromDesignObject()`:

```typescript
const projectedFrame = meta.type === "image"
  ? frameFromDesignObject(object, fallback)
  : {
      x: Math.round(numberOr(object.left, fallback.x)),
      y: Math.round(numberOr(object.top, fallback.y)),
      width: Math.round(numberOr(object.width, fallback.width) * scaleX),
      height,
    };

const next: AdStudioCanvasObject = {
  ...fallback,
  type: meta.type,
  role: meta.role,
  x: projectedFrame.x,
  y: projectedFrame.y,
  width: projectedFrame.width,
  height: projectedFrame.height,
  ...
};

if (next.type === "image") {
  next.content = typeof object.src === "string" ? object.src : fallback.content;
  next.imagePlacement = imagePlacementFromDesignObject(object);
}
```

- [ ] **Step 4: Include `clipPath` in Fabric JSON reads**

In `src/lib/adstudio/creative-design-json.ts`, add `"clipPath"` to `FABRIC_JSON_EXTRA_KEYS`.

In `src/components/adstudio/canvas/fabric-ad-editor.tsx`, verify `readCanvasJson()` includes the same key through `FABRIC_JSON_EXTRA_KEYS`.

- [ ] **Step 5: Render `imagePlacement` in browser exports**

In `src/components/adstudio/canvas/browser-creative-renderer.ts`, update `drawImageObject()`:

```typescript
const placement = object.imagePlacement;
if (placement) {
  ctx.save();
  roundedRect(ctx, object.x, object.y, width, height, radius);
  ctx.clip();
  ctx.drawImage(image, placement.x, placement.y, placement.width, placement.height);
  ctx.restore();
  return;
}
```

Keep the current `drawImageCover()` fallback for objects without placement.

- [ ] **Step 6: Render `imagePlacement` in SVG fallback**

In `src/lib/adstudio/renderer.ts`, update image rendering:

```typescript
if (object.type === "image") {
  const src = object.content ?? object.assetId;
  if (src && isRenderableImageSrc(src)) {
    const clip = imageClipPath(object, defs);
    const placement = object.imagePlacement;
    if (placement) {
      return `<image x="${placement.x}" y="${placement.y}" width="${placement.width}" height="${placement.height}" href="${escapeXml(src)}" preserveAspectRatio="none"${clip}/>`;
    }
    return `<image x="${object.x}" y="${object.y}" width="${object.width}" height="${height}" href="${escapeXml(src)}" preserveAspectRatio="${preserveAspectRatioForAnchor(object.imageAnchor)} slice"${clip}/>`;
  }
}
```

- [ ] **Step 7: Stop stripping Fabric JSON before save/export rendering**

In `src/components/adstudio/use-campaign-actions.ts`, replace `stripRenderState()` with two explicit compaction helpers:

```typescript
function stripPreviewState(creative: AdStudioCampaignPack["creatives"][number]): AdStudioCampaignPack["creatives"][number] {
  return {
    ...creative,
    previewSvg: "",
  };
}
```

Update:

```typescript
.map(stripRenderState)
```

to:

```typescript
.map(stripPreviewState)
```

for both `compactPackForDraft()` and `packForVariant()`.

Add a regression assertion:

```typescript
test("draft and export compaction keep Fabric design JSON", () => {
  const actions = readFileSync("src/components/adstudio/use-campaign-actions.ts", "utf8");
  assert.doesNotMatch(actions, /fabricJson:\s*null/);
  assert.match(actions, /function stripPreviewState/);
});
```

- [ ] **Step 8: Verify and commit**

Run:

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/adstudio-creative-design-json.test.ts tests/adstudio-real-loop-regressions.test.ts
npm run typecheck
```

Expected:
- Creative design projection tests pass.
- No TypeScript errors from new `imagePlacement` type.

Commit:

```powershell
git add src/lib/adstudio/types.ts src/lib/adstudio/creative-design-json.ts src/lib/adstudio/creative-design-builder.ts src/components/adstudio/canvas/fabric-ad-editor.tsx src/components/adstudio/canvas/browser-creative-renderer.ts src/lib/adstudio/renderer.ts src/components/adstudio/use-campaign-actions.ts tests/adstudio-creative-design-json.test.ts tests/adstudio-real-loop-regressions.test.ts
git commit -m "fix: preserve fabric editor state for export"
```

### Task 7: Add Save/Reload/Export Runtime Coverage

**Files:**
- Modify: `e2e/adstudio-real-loop.spec.ts`

- [ ] **Step 1: Extend the existing real-loop test**

After the headline edit in `e2e/adstudio-real-loop.spec.ts`, add a canvas drag before `saveDraft(page)`:

```typescript
await dragCanvasLayer(page, { fromX: 0.5, fromY: 0.72, toX: 0.56, toY: 0.76 });
```

Add helper:

```typescript
async function dragCanvasLayer(
  page: Page,
  input: { fromX: number; fromY: number; toX: number; toY: number },
) {
  const canvas = page.locator(".studio-fabric-shell canvas").first();
  await expect(canvas).toBeVisible({ timeout: 30_000 });
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  if (!box) return;

  await page.mouse.move(box.x + box.width * input.fromX, box.y + box.height * input.fromY);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * input.toX, box.y + box.height * input.toY, { steps: 8 });
  await page.mouse.up();
}
```

- [ ] **Step 2: Add a template path to the real-loop test**

Keep the blank path, but add a second test that selects a visible template and uploads all required images:

```typescript
test("template start requests required media, persists editor edits, and exports", async ({ page }, testInfo) => {
  await page.goto(`/ad-studio?workspaceId=${encodeURIComponent(workspaceId ?? "")}`);
  await openNewAd(page);
  await page.getByRole("button", { name: /use template/i }).first().click();
  await uploadGeneratedListingImage(page, testInfo.outputPath("template-listing.png"));
  await page.getByLabel(/short description/i).fill("Fresh local listing with a renovated kitchen and Saturday inspection.");
  await page.getByRole("button", { name: /generate ad/i }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 90_000 });
  await dragCanvasLayer(page, { fromX: 0.5, fromY: 0.45, toX: 0.52, toY: 0.47 });
  await saveDraft(page);
  await waitForSavedStatus(page);
  await openPanel(page, "Publish");
  await exportCreatives(page);
});
```

If the first visible template requires multiple slots, extend `uploadGeneratedListingImage()` to upload each visible `.studio-newad input[type="file"]` with a generated file.

- [ ] **Step 3: Run local static tests**

Run:

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/adstudio-creative-design-json.test.ts tests/adstudio-real-loop-regressions.test.ts
npm run typecheck
```

Expected:
- Local tests pass.
- E2E may skip locally if preview credentials are absent.

- [ ] **Step 4: Commit**

Run:

```powershell
git add e2e/adstudio-real-loop.spec.ts
git commit -m "test: cover ad studio editor save export loop"
```

### Task 8: Keep Mobile And Deleted Repair Routes Explicit

**Files:**
- Modify: `tests/adstudio-mobile-flow.test.ts`
- Modify: `tests/adstudio-real-loop-regressions.test.ts`

- [ ] **Step 1: Add a mobile preview-only guard**

In `tests/adstudio-mobile-flow.test.ts`, add:

```typescript
test("mobile media and text tabs remain preview-only until Fabric mobile parity is built", () => {
  const workbench = read("src/components/adstudio/ad-studio-workbench.tsx");

  const mobileStart = workbench.indexOf('<div className="studio-mobile-body">');
  const mobileBlock = workbench.slice(mobileStart);
  assert.match(mobileBlock, /<AdPreview/);
  assert.doesNotMatch(mobileBlock, /<FabricAdEditor/);
});
```

- [ ] **Step 2: Keep repair route deletion assertions**

In `tests/adstudio-real-loop-regressions.test.ts`, keep `src/app/api/adstudio/repair-image/route.ts` and `src/app/api/adstudio/generate-image/route.ts` in the deleted endpoint list.

Add:

```typescript
assert.match(createRoute, /queueAdStudioTemplatePhotoPrep/);
assert.doesNotMatch(createRoute, /\/api\/adstudio\/repair-image|\/api\/adstudio\/generate-image/);
```

- [ ] **Step 3: Verify and commit**

Run:

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/adstudio-mobile-flow.test.ts tests/adstudio-real-loop-regressions.test.ts
git add tests/adstudio-mobile-flow.test.ts tests/adstudio-real-loop-regressions.test.ts
git commit -m "test: guard ad studio mobile and repair boundaries"
```

### Task 9: Full Local Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test tests/adstudio-template-library-order.test.ts tests/adstudio-template-resolver.test.ts tests/adstudio-creative-design-json.test.ts tests/adstudio-mobile-flow.test.ts tests/adstudio-real-loop-regressions.test.ts
```

Expected:
- All focused tests pass.

- [ ] **Step 2: Run full repository checks**

Run:

```powershell
npm run typecheck
npm run test
```

Expected:
- Typecheck passes.
- Full test suite passes.

- [ ] **Step 3: Inspect final diff**

Run:

```powershell
git status --short --branch
git log --oneline -5
```

Expected:
- Every intended code/test change is committed.
- Worktree is clean or only contains explicitly retained deliverables.

### Task 10: Vercel Runtime Acceptance

**Files:**
- No source file changes unless runtime testing finds a defect.

- [ ] **Step 1: Push branch**

Run:

```powershell
git push
```

Expected:
- Branch pushes successfully.

- [ ] **Step 2: Deploy committed source to Vercel Preview**

Use the repo's normal Vercel flow. Do not use localhost for acceptance.

Run one of:

```powershell
vercel --yes
```

or use the existing PR preview deployment if CI already produced one.

Expected:
- Preview deployment reaches `READY`.

- [ ] **Step 3: Run preview E2E**

Run only when preview URL, workspace ID, and auth state exist:

```powershell
$env:PLAYWRIGHT_BASE_URL="https://<vercel-preview-url>"
$env:ADSTUDIO_E2E_WORKSPACE_ID="<dedicated-test-workspace-id>"
$env:ADSTUDIO_E2E_STORAGE_STATE="e2e/.auth/adstudio-test.storage-state.json"
npm run test:e2e:preview
```

Expected:
- First-run blank path passes.
- Template path passes.
- Draft save/reload works.
- Export ZIP request returns success.

- [ ] **Step 4: Manual Vercel acceptance**

On the Vercel Preview URL:

1. Open Ad Studio.
2. Open Templates.
3. Confirm built-in templates appear.
4. Confirm at least one approved DB/operator/radar template appears when the research view has approved rows.
5. Select an approved DB template.
6. Confirm the upload screen requests the exact required image slots.
7. Try Generate Ad with missing description and missing image slots.
8. Confirm the large requirements alert is visible.
9. Add required images and a description.
10. Generate Story, Feed, and Square.
11. Move a text layer on desktop.
12. Fit or replace the photo.
13. Save draft.
14. Reload the campaign.
15. Confirm text/image placement remains.
16. Export ZIP.
17. Confirm exported PNG/JPEG visually match the editor for Story, Feed, and Square.

- [ ] **Step 5: Promote or merge only after green acceptance**

If the preview passes and PR checks are green, merge/deploy through the normal path. If preview E2E cannot run because credentials are missing, report the exact missing env and keep the PR unmerged until Steven provides them.

### Task 11: Cleanup And Final Report

**Files:**
- Read: `hermes/skills/blockwise-agent-cleanup/SKILL.md`

- [ ] **Step 1: Run cleanup inventory**

Run:

```powershell
git status --short --branch
git diff --name-only
git ls-files --others --exclude-standard
git worktree list --porcelain
gh pr list --repo stevenshelley58-afk/blockwise --limit 10
gh run list --repo stevenshelley58-afk/blockwise --limit 10
```

Expected:
- No agent-created scratch files remain.
- No secrets, `.env*`, databases, build output, `node_modules`, or local agent state are staged.

- [ ] **Step 2: Final report content**

Report:

- Template library and resolver fixes.
- Fabric save/reload/export parity result.
- Vercel Preview or Production URL used for acceptance.
- Exact tests that passed.
- Cleanup result.
- Any remaining dirty files or blocked items with one command Steven can run.

## Sequencing Recommendation

Do this as two PRs if the branch is busy:

1. Template picker/resolver and missing-info alert:
   - Tasks 2, 3, 4, 8, 9, 10, 11.
   - This unblocks approved templates reaching customers and clearer validation.
2. Fabric persistence/export parity:
   - Tasks 5, 6, 7, 8, 9, 10, 11.
   - This is higher risk because it touches the editor, export renderer, SVG fallback, and campaign compaction.

If the active template-generation branch is still producing standalone templates, prefer a fresh branch from `origin/main` for this hardening work and merge forward after the current production checkpoint is stable.

## Acceptance Checklist

- [ ] No external Canva/editor repo was imported.
- [ ] Approved DB/operator/radar templates appear in the picker.
- [ ] Built-in/gold templates win duplicate keys.
- [ ] Draft and archived rows do not appear.
- [ ] Server generation rejects arbitrary template keys.
- [ ] Server generation accepts exact approved DB template keys.
- [ ] Missing Generate Ad requirements render as a prominent alert.
- [ ] Desktop Fabric text move/resize survives save and reload.
- [ ] Desktop Fabric image replace/fit/crop survives save and reload.
- [ ] Exported PNG/JPEG match the editor for Story, Feed, and Square.
- [ ] Mobile preview remains non-corrupting and does not overwrite desktop Fabric state.
- [ ] Deleted repair/generate-image API routes remain deleted.
- [ ] `npm run typecheck` passes.
- [ ] `npm run test` passes.
- [ ] Runtime acceptance is verified on Vercel Preview or Production, not localhost.
