import { NextResponse, type NextRequest } from "next/server";

import { requireAdStudioRequest } from "@/lib/adstudio/http";
import { loadLiveAdStudioBundle } from "@/lib/adstudio/load-live-bundle";
import {
  adDocInstanceTemplateViolation,
  adDocInstanceSchema,
  isAdDocInstanceShape,
  type AdDocInstance,
} from "@/lib/adstudio/v2/template-doc";
import { loadTemplateV2ByHash, matchesAdDocTemplatePin } from "@/lib/adstudio/v2/template-resolver";
import { renderAdDocToPng } from "@/lib/adstudio/v2/render/server.ts";
import { AdDocSlotMediaError, persistAdDocRender, resolveAdDocSlotBytes } from "@/lib/adstudio/v2/media.ts";
import {
  appendAdStudioCreativeRevision,
  executeAdStudioCreativeRevisionMutation,
  releaseAdStudioCreativeRevisionMutation,
} from "@/lib/adstudio/creative-revisions";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

// POST /api/adstudio/creatives/[id]/doc (Track A, §6): save an instance-doc
// mutation. Validates against the template (guided whitelist, locked layers),
// re-renders server-side (canonical pixels = f(doc)), appends a revision via
// the existing CAS RPC. 409 semantics unchanged (ADSTUDIO_STALE_REVISION).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type DocMutationBody = {
  mutationId?: string;
  expectedRevisionId?: string;
  instance?: unknown;
};

export async function POST(request: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  const { id } = await routeContext.params;
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;

  const body = (await request.json().catch(() => null)) as DocMutationBody | null;
  if (!body?.mutationId || !body.instance || typeof body.expectedRevisionId !== "string") {
    return NextResponse.json(
      { error: "mutationId, instance and expectedRevisionId are required." },
      { status: 400 },
    );
  }

  const parsed = adDocInstanceSchema.safeParse(body.instance);
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Instance doc invalid: ${parsed.error.issues[0]?.message ?? "schema"}` },
      { status: 422 },
    );
  }
  const instance: AdDocInstance = parsed.data;

  // Validate the current, workspace-scoped creative before doing any media
  // resolution, render, storage write, or mutation claim. The CAS RPC below
  // remains the authority for freshness; this check only establishes that the
  // submitted document is editing this creative's immutable template pin.
  const { data: creative, error: creativeError } = await access.supabase
    .from("adstudio_creatives")
    .select("canvas_json")
    .eq("workspace_id", access.access.workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (creativeError) {
    return NextResponse.json({ error: "The ad could not be loaded." }, { status: 500 });
  }
  if (!creative) return NextResponse.json({ error: "Ad not found." }, { status: 404 });
  if (!matchesAdDocTemplatePin(creative.canvas_json, instance)) {
    return NextResponse.json({ error: "ADSTUDIO_TEMPLATE_PIN_MISMATCH" }, { status: 409 });
  }

  const template = loadTemplateV2ByHash(instance.templateId, instance.templateHash);
  if (!template) {
    return NextResponse.json({ error: "ADSTUDIO_TEMPLATE_VERSION_UNAVAILABLE" }, { status: 409 });
  }

  const violation = adDocInstanceTemplateViolation(template, instance);
  if (violation) return NextResponse.json({ error: violation }, { status: 422 });

  const serviceSupabase = createSupabaseServiceClient();
  let slotBytes: Map<string, Buffer>;
  try {
    slotBytes = await resolveAdDocSlotBytes({
      supabase: serviceSupabase,
      workspaceId: access.access.workspaceId,
      template,
      instance,
    });
  } catch (error) {
    if (error instanceof AdDocSlotMediaError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
  const { createHash } = await import("node:crypto");
  const requestHash = createHash("sha256").update(JSON.stringify(body.instance)).digest("hex");
  const claim = await executeAdStudioCreativeRevisionMutation(
    access.supabase as never,
    {
      workspaceId: access.access.workspaceId,
      creativeId: id,
      mutationId: body.mutationId,
      expectedActiveRevisionId: body.expectedRevisionId,
      requestHash,
    },
    async () => {
      // Canonical re-render: feed + story when present.
      const renders: { feed?: string; story?: string } = {};
      const formats: Array<["feed" | "story", "4:5" | "9:16"]> = [
        ["feed", "4:5"],
        ...(template.formats.story ? ([["story", "9:16"]] as Array<["story", "9:16"]>) : []),
      ];
      for (const [slot, format] of formats) {
        const png = await renderAdDocToPng(template, { ...instance, format }, format, { slotBytes });
        const storagePath = await persistAdDocRender({
          supabase: serviceSupabase as never,
          workspaceId: access.access.workspaceId,
          bytes: new Uint8Array(png),
          name: `${id}-${slot}`,
        });
        renders[slot] = storagePath;
      }
      const storedInstance: AdDocInstance = { ...instance, renders };

      const revision = await appendAdStudioCreativeRevision(access.supabase as never, {
        workspaceId: access.access.workspaceId,
        creativeId: id,
        expectedActiveRevisionId: body.expectedRevisionId!,
        canvas: storedInstance,
        renderStatus: "rendered",
        // The DB CHECK allows targeted_edit as the generic edit op; v2 doc
        // saves carry the full instance in canvas (no new DDL, plan §11).
        creationOperation: "targeted_edit",
        mutationId: body.mutationId!,
        requestHash,
      });
      if (!revision.ok) {
        throw new Error("ADSTUDIO_STALE_REVISION");
      }
      return { revisionId: revision.revisionId, renders };
    },
  );

  if (!claim.ok || claim.state === "completed") {
    return NextResponse.json({ error: "This edit is already being processed." }, { status: 409 });
  }
  if (claim.state === "work_failed") {
    await releaseAdStudioCreativeRevisionMutation(access.supabase as never, {
      workspaceId: access.access.workspaceId,
      creativeId: id,
      mutationId: body.mutationId,
    }).catch(() => undefined);
    const stale = claim.error instanceof Error && claim.error.message.includes("ADSTUDIO_STALE_REVISION");
    return NextResponse.json(
      { error: stale ? "ADSTUDIO_STALE_REVISION" : "The ad could not be saved." },
      { status: stale ? 409 : 500 },
    );
  }

  void isAdDocInstanceShape;
  return NextResponse.json(claim.value);
}

// GET returns the active instance doc if the creative is v2-shaped — lets the
// editor hydrate straight from the CAS chain.
export async function GET(request: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  const { id } = await routeContext.params;
  const access = await requireAdStudioRequest(request);
  if (!access.ok) return access.response;

  const bundle = await loadLiveAdStudioBundle(access.supabase, access.access.workspaceId, null);
  const creative = bundle?.campaignPack.creatives.find((item) => item.creativeId === id);
  if (!creative) return NextResponse.json({ error: "Ad not found." }, { status: 404 });
  if (!isAdDocInstanceShape(creative.canvas)) {
    return NextResponse.json({ error: "This ad is not a v2 doc yet." }, { status: 404 });
  }
  return NextResponse.json({
    instance: creative.canvas,
    activeRevisionId: creative.activeRevisionId ?? null,
  });
}
