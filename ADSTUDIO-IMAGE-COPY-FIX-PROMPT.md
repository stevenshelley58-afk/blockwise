# Codex Task — Make the uploaded image actually drive Ad Studio copy, then ship it

## TL;DR for Codex
Ad Studio generates ad copy ("drafts"/templates) that **ignore the user's uploaded
image**. Copy is produced from text context only, and when the AI provider fails it
**silently falls back to canned template copy**. Fix: send the uploaded image to the
copy model so drafts reflect the photo, and surface real errors instead of silent
template fallback. Then typecheck, test, commit, push to `main`, and confirm the
Vercel production deploy.

## Authorization / guardrails (AGENTS.md)
- Sending the image to the text/copy model is a **provider-behaviour change**. The repo
  owner has **explicitly authorized** this specific change. Do not use it as license for
  other provider/auth/schema changes.
- Do **not** change auth behaviour, DB schema, or public API response shapes.
- No new dependencies.

## First: check whether the edits already exist
These edits were applied in a Cowork session but **not committed**. Before implementing,
run:

```bash
git status
git diff -- src/lib/adstudio src/app/api/adstudio src/components/adstudio
```

If the changes below are already present in the working tree, **just verify them** and
jump to "Build & ship". Otherwise, implement them exactly as specified.

---

## Changes by file

### 1. `src/lib/adstudio/providers.ts`
Add an optional image to the text request type:

```ts
export type TextProviderRequest = {
  system: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  schemaName: ProviderSchemaName;
  /**
   * Optional image (a `data:` URL or absolute http(s) URL) attached to the final
   * user message for vision-capable models. Ignored by text-only providers.
   */
  imageUrl?: string;
};
```

### 2. `src/lib/adstudio/ai-providers.ts`
Both OpenAI and OpenRouter text providers already declare `visionInput: true` and post
to chat-completions, which accept multimodal `content` arrays. Route the messages
through a builder that attaches the image to the final user message.

In `postChatCompletion`, replace the inline messages array:

```ts
// before
      messages: [
        { role: "system", content: input.input.system },
        ...input.input.messages,
      ],
// after
      messages: buildChatMessages(input.input),
```

Add this helper (e.g. just above `parseJson`):

```ts
// Builds the chat payload. When an image is supplied, it is attached to the final
// user message as a multimodal content array (OpenAI/OpenRouter vision format).
function buildChatMessages(request: TextProviderRequest): unknown[] {
  const system = { role: "system", content: request.system };

  if (!request.imageUrl) {
    return [system, ...request.messages];
  }

  const messages: Array<{ role: "user" | "assistant"; content: unknown }> = request.messages.map(
    (message) => ({ role: message.role, content: message.content }),
  );
  const imagePart = { type: "image_url", image_url: { url: request.imageUrl } };

  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "user") {
      lastUserIndex = index;
      break;
    }
  }

  if (lastUserIndex >= 0) {
    messages[lastUserIndex] = {
      role: "user",
      content: [{ type: "text", text: String(messages[lastUserIndex].content) }, imagePart],
    };
  } else {
    messages.push({ role: "user", content: [imagePart] });
  }

  return [system, ...messages];
}
```

### 3. `src/lib/adstudio/resolve-image-for-model.ts` (NEW FILE)
Vision models can only read images they can fetch. Uploaded media is served through an
auth-gated proxy (`/api/adstudio/media?path=...`) from a private bucket, so it must be
inlined as a data URL. `data:` and absolute http(s) URLs pass through.

```ts
import type { createSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;

// Vision models can only read images they can actually fetch. Uploaded Ad Studio
// media is served through an auth-gated proxy (`/api/adstudio/media?path=...`) from a
// private storage bucket, so it must be inlined as a data URL before it reaches a
// provider. `data:` and absolute http(s) URLs are already model-consumable.
const MAX_INLINE_IMAGE_BYTES = 6_000_000;

export async function resolveAdStudioImageForModel(
  supabase: SupabaseServerClient,
  workspaceId: string,
  ref: string | undefined,
): Promise<string | undefined> {
  if (!ref) return undefined;
  if (ref.startsWith("data:image/")) return ref;
  if (/^https?:\/\//i.test(ref)) return ref;

  const storagePath = mediaProxyPath(ref);
  if (!storagePath) return undefined;
  if (!storagePath.startsWith(`${workspaceId}/`) || storagePath.includes("..")) return undefined;

  const { data, error } = await supabase.storage.from("workspace-artifacts").download(storagePath);
  if (error || !data || data.size > MAX_INLINE_IMAGE_BYTES) return undefined;

  const buffer = Buffer.from(await data.arrayBuffer());
  const contentType = data.type || "image/jpeg";
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

function mediaProxyPath(ref: string): string | undefined {
  if (!ref.startsWith("/api/adstudio/media?")) return undefined;
  const query = ref.split("?")[1] ?? "";
  const path = new URLSearchParams(query).get("path")?.trim();
  return path || undefined;
}
```

### 4. `src/lib/adstudio/copy-generation.ts`
- Add `sourceImageUrl?: string` to `AdStudioCopyRequestBody` (it flows into
  `AdStudioCopyGenerationInput` automatically):

```ts
  copy?: Partial<AdStudioCopyFields>;
  /**
   * Image the copy should be grounded in, already resolved to a model-consumable
   * reference (`data:` URL or absolute http(s) URL). See resolveAdStudioImageForModel.
   */
  sourceImageUrl?: string;
```

- Add a grounding instruction constant (near `COPY_PROMPT_KEYS`):

```ts
const IMAGE_GROUNDING_INSTRUCTION =
  "An image of the advertised property is attached. Ground the copy in what is actually visible in it — the property's style, setting, and standout features — and do not invent details that contradict the image.";
```

- In `generateAdStudioCopy`, after `assembleMetaCopyPrompt(...)`, compute the image and
  user prompt, and pass the image to the profile runner:

```ts
  const imageUrl = usableModelImage(input.sourceImageUrl);
  const userPrompt = imageUrl ? `${assembled.user}\n\n${IMAGE_GROUNDING_INSTRUCTION}` : assembled.user;
  let generation: CopyGenerationResult | null = null;

  try {
    generation = await generateCopyWithProfile(assembled.system, userPrompt, imageUrl);
```

- Add the guard and thread `imageUrl` into `generateCopyWithProfile` — pass
  `imageUrl` on BOTH `provider.generate({ ... })` calls (the candidate loop and the
  legacy provider):

```ts
// Only forward references a vision model can actually read.
function usableModelImage(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  return ref.startsWith("data:image/") || /^https?:\/\//i.test(ref) ? ref : undefined;
}

async function generateCopyWithProfile(
  system: string,
  user: string,
  imageUrl?: string,
): Promise<CopyGenerationResult> {
  // ...existing body...
  // each provider.generate(...) call gains:  imageUrl,
}
```

### 5. `src/lib/adstudio/campaign-copy-enrichment.ts`
- Add `sourceImageUrl?: string` to the `enrichCampaignPackCopyWithAi` input.
- Pass `sourceImageUrl: input.sourceImageUrl` into the per-variant `generateAdStudioCopy(...)` call.
- **Stop the silent fallback**: capture the last error and rethrow when nothing was
  enriched, so the route returns a real error instead of shipping unwritten template copy:

```ts
  let pack = input.pack;
  let changed = false;
  let lastError: unknown = null;
  // ...
    } catch (error) {
      lastError = error;
      break;
    }
  }

  // Surface a real failure instead of silently shipping the unwritten template copy.
  if (!changed) {
    if (lastError) throw lastError;
    return input.pack;
  }
```

### 6. `src/app/api/adstudio/copy/route.ts`
Resolve the client-supplied image server-side and pass it through:

```ts
import { resolveAdStudioImageForModel } from "@/lib/adstudio/resolve-image-for-model";
// ...
    const sourceImageUrl = await resolveAdStudioImageForModel(
      access.supabase,
      access.access.workspaceId,
      body.sourceImageUrl,
    );
    const result = await generateAdStudioCopy({
      ...body,
      sourceImageUrl,
      workspaceId: access.access.workspaceId,
      userId: access.access.userId,
    });
```

### 7. `src/app/api/adstudio/campaigns/route.ts` (the main generate path the UI uses)
```ts
import { resolveAdStudioImageForModel } from "@/lib/adstudio/resolve-image-for-model";
// ...
    const sourceImageUrl = await resolveAdStudioImageForModel(
      context.supabase,
      context.access.workspaceId,
      body.sourceImageDataUrl ?? body.firstAd?.imageDataUrl,
    );
    pack = await enrichCampaignPackCopyWithAi({
      pack,
      workspaceId: context.access.workspaceId,
      userId: context.access.userId,
      brief: body.firstAd?.description,
      templateName: template?.name,
      templateHint: template?.promptHint,
      sourceImageUrl,
    });
```

### 8. `src/app/api/adstudio/campaigns/[id]/generate/route.ts` (secondary path, same bug)
```ts
import { resolveAdStudioImageForModel } from "@/lib/adstudio/resolve-image-for-model";
// ...
    const sourceImageUrl = await resolveAdStudioImageForModel(
      access.supabase,
      access.access.workspaceId,
      body.sourceImageDataUrl,
    );
    pack = await enrichCampaignPackCopyWithAi({
      pack,
      workspaceId: access.access.workspaceId,
      userId: access.access.userId,
      sourceImageUrl,
    });
```

### 9. `src/components/adstudio/use-copy.ts` (interactive copy buttons)
Add an optional `imageSrc` param to `generateCopy`, `applyCopyAssist`, and
`patchCopyField`, and include it as `sourceImageUrl` in each `requestCopy(...)` payload.
Example for `generateCopy`:

```ts
  async function generateCopy(kind: "ai" | "brief", context: CopyContext, imageSrc?: string) {
    // ...
      const result = await requestCopy({
        mode: kind === "brief" ? "brief" : "generate",
        brief: kind === "brief" ? brief.trim() : undefined,
        copy,
        context,
        sourceImageUrl: imageSrc,
      });
```
Do the same (`sourceImageUrl: imageSrc`) in `applyCopyAssist` and `patchCopyField`.

### 10. `src/components/adstudio/ad-studio-workbench.tsx` (pass the current image)
`primaryImage` is in scope at the call sites. Pass it as the new last arg:

```ts
// patch handler
await patchCopyField(field, patchActionForSelectedElement(selectedElement), copyContext, primaryImage);

// both CopyPanel usages (desktop + mobile)
onGenerate={(kind, context) => void generateCopy(kind, context, primaryImage)}
onAssist={(action, context) => void applyCopyAssist(action, context, primaryImage)}
```

---

## Build & ship
```bash
npm run typecheck
npm test            # or: node --test tests/adstudio-ai-providers.test.ts tests/adstudio-real-loop-regressions.test.ts

git add src/lib/adstudio/providers.ts src/lib/adstudio/ai-providers.ts \
        src/lib/adstudio/copy-generation.ts src/lib/adstudio/campaign-copy-enrichment.ts \
        src/lib/adstudio/resolve-image-for-model.ts \
        src/app/api/adstudio/copy/route.ts src/app/api/adstudio/campaigns/route.ts \
        "src/app/api/adstudio/campaigns/[id]/generate/route.ts" \
        src/components/adstudio/use-copy.ts src/components/adstudio/ad-studio-workbench.tsx
git commit -m "Ad Studio: ground generated copy in the uploaded image; surface AI failures instead of template fallback"
git push origin main
```
Vercel auto-deploys `main`. Per AGENTS.md, verify on the **Vercel Production URL** (not
localhost):
1. Upload an image, generate an ad — the headline/primary text should reference what's
   actually in the photo.
2. Force a provider failure (e.g. temporarily bad key) — you should see a real error,
   not silent canned template copy.

## Notes / caveats
- The copy model must be vision-capable (the configured `gpt-5.5` / `openai/gpt-5.5`
  defaults are). If a non-vision model is forced via the runtime profile, the attempt
  fails and falls through to the next candidate.
- Uploaded images over ~6 MB are skipped for inlining (copy still generates from text
  context); raise `MAX_INLINE_IMAGE_BYTES` if needed.
- This intentionally does **not** touch the unrelated dirty files already in the worktree
  (`next.config.ts`, `MetaMonitorDashboard.tsx`, `site-analytics-dashboard.tsx`,
  `sw-policy.ts`, etc.).
