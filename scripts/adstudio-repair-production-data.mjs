#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  createSupabaseServerClient,
  resolveSupabaseServerCredential,
} from "./lib/supabase-server-credential.mjs";

const EXECUTE = process.argv.includes("--execute");
const DELETE_DEMO_KITS = process.argv.includes("--delete-demo-kits");
const WORKSPACE_ID = argValue("--workspace-id");
const BUCKET = "workspace-artifacts";

const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serverCredential = resolveSupabaseServerCredential(process.env);

if (!supabaseUrl || !serverCredential) {
  console.error("Set SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY before running.");
  process.exit(1);
}

const supabase = createSupabaseServerClient(createClient, supabaseUrl, process.env, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const summary = {
  mode: EXECUTE ? "execute" : "dry-run",
  workspaceId: WORKSPACE_ID ?? "all",
  demoBrandKitIds: [],
  campaignsRepointed: [],
  campaignsWithoutRealKit: [],
  creativeRowsWithBase64: [],
  creativeRowsUpdated: [],
  uploadedImages: [],
  demoBrandKitsDeleted: [],
};

const brandKits = await selectAll(
  "adstudio_brand_kits",
  "id,workspace_id,source_url,review_status,updated_at,created_at",
  (query) => WORKSPACE_ID ? query.eq("workspace_id", WORKSPACE_ID) : query,
);
const demoBrandKits = brandKits.filter((kit) => isExampleUrl(kit.source_url));
const realApprovedByWorkspace = latestApprovedRealKits(brandKits);
summary.demoBrandKitIds = demoBrandKits.map((kit) => String(kit.id));

await repointDemoCampaigns(demoBrandKits, realApprovedByWorkspace);
await repairBase64CreativeRows();
await maybeDeleteDemoBrandKits(demoBrandKits);
await verifyClean();

console.log(JSON.stringify(summary, null, 2));
if (!EXECUTE) {
  console.log("Dry run only. Re-run with --execute to write repairs.");
}

async function repointDemoCampaigns(demoKits, realKitsByWorkspace) {
  if (demoKits.length === 0) return;
  const demoIds = demoKits.map((kit) => String(kit.id));
  const campaigns = await selectAll(
    "adstudio_campaigns",
    "id,workspace_id,brand_kit_id",
    (query) => scopeWorkspace(query.in("brand_kit_id", demoIds)),
  );

  for (const campaign of campaigns) {
    const realKit = realKitsByWorkspace.get(String(campaign.workspace_id));
    if (!realKit) {
      summary.campaignsWithoutRealKit.push(String(campaign.id));
      continue;
    }

    summary.campaignsRepointed.push({
      campaignId: String(campaign.id),
      workspaceId: String(campaign.workspace_id),
      fromBrandKitId: String(campaign.brand_kit_id),
      toBrandKitId: String(realKit.id),
    });

    if (EXECUTE) {
      const { error } = await supabase
        .from("adstudio_campaigns")
        .update({ brand_kit_id: realKit.id, updated_at: new Date().toISOString() })
        .eq("id", campaign.id)
        .eq("workspace_id", campaign.workspace_id);
      if (error) throw new Error(`Could not repoint campaign ${campaign.id}: ${error.message}`);
    }
  }
}

async function repairBase64CreativeRows() {
  const creativeRows = await selectAll(
    "adstudio_creatives",
    "id,workspace_id,campaign_id,variant_id,format,canvas_json",
    (query) => scopeWorkspace(query),
  );
  const uploadByImageKey = new Map();

  for (const row of creativeRows) {
    const canvas = normalObject(row.canvas_json);
    const image = primaryImageObject(canvas);
    const dataUrl = typeof image?.content === "string" && image.content.startsWith("data:image/") ? image.content : "";
    if (!dataUrl) continue;

    const rowId = String(row.id);
    summary.creativeRowsWithBase64.push(rowId);
    const variantKey = `${row.workspace_id}:${row.campaign_id}:${row.variant_id}`;
    const imageHash = sha256(dataUrl);
    const uploadKey = `${variantKey}:${imageHash}`;
    let publicPath = uploadByImageKey.get(uploadKey);

    if (!publicPath) {
      const decoded = decodeDataUrl(dataUrl);
      const storagePath = [
        String(row.workspace_id),
        "adstudio-repair",
        String(row.campaign_id),
        `${String(row.variant_id)}-${imageHash.slice(0, 16)}.${decoded.extension}`,
      ].join("/");
      publicPath = mediaUrl(storagePath);
      uploadByImageKey.set(uploadKey, publicPath);
      summary.uploadedImages.push({ campaignId: String(row.campaign_id), variantId: String(row.variant_id), storagePath });

      if (EXECUTE) {
        const { error } = await supabase.storage.from(BUCKET).upload(storagePath, decoded.bytes, {
          contentType: decoded.contentType,
          upsert: true,
        });
        if (error) throw new Error(`Could not upload repaired creative image ${storagePath}: ${error.message}`);
      }
    }

    const nextCanvas = {
      ...canvas,
      fabricJson: null,
      objects: Array.isArray(canvas.objects)
        ? canvas.objects.map((object) =>
            object?.role === "primary_image" ? { ...object, content: publicPath, assetId: undefined } : object,
          )
        : [],
    };
    summary.creativeRowsUpdated.push(rowId);

    if (EXECUTE) {
      const { error } = await supabase
        .from("adstudio_creatives")
        .update({ canvas_json: nextCanvas, preview_svg: null, updated_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("workspace_id", row.workspace_id);
      if (error) throw new Error(`Could not repair creative ${row.id}: ${error.message}`);
    }
  }
}

async function maybeDeleteDemoBrandKits(demoKits) {
  if (!DELETE_DEMO_KITS || demoKits.length === 0) return;
  const demoIds = demoKits.map((kit) => String(kit.id));
  const remainingCampaigns = await selectAll(
    "adstudio_campaigns",
    "id,workspace_id,brand_kit_id",
    (query) => scopeWorkspace(query.in("brand_kit_id", demoIds)),
  );
  const blockedKitIds = new Set(remainingCampaigns.map((row) => String(row.brand_kit_id)));
  const deletableIds = demoIds.filter((id) => !blockedKitIds.has(id));

  if (deletableIds.length === 0) return;
  summary.demoBrandKitsDeleted = deletableIds;

  if (EXECUTE) {
    const assetDelete = await supabase.from("adstudio_brand_assets").delete().in("brand_kit_id", deletableIds);
    if (assetDelete.error) throw new Error(`Could not delete demo brand assets: ${assetDelete.error.message}`);
    const kitDelete = await supabase.from("adstudio_brand_kits").delete().in("id", deletableIds);
    if (kitDelete.error) throw new Error(`Could not delete demo brand kits: ${kitDelete.error.message}`);
  }
}

async function verifyClean() {
  const kits = await selectAll(
    "adstudio_brand_kits",
    "id,workspace_id,source_url",
    (query) => WORKSPACE_ID ? query.eq("workspace_id", WORKSPACE_ID) : query,
  );
  const demoIds = kits.filter((kit) => isExampleUrl(kit.source_url)).map((kit) => String(kit.id));
  const demoCampaigns = demoIds.length
    ? await selectAll(
        "adstudio_campaigns",
        "id,workspace_id,brand_kit_id",
        (query) => scopeWorkspace(query.in("brand_kit_id", demoIds)),
      )
    : [];
  const creativeRows = await selectAll(
    "adstudio_creatives",
    "id,workspace_id,canvas_json",
    (query) => scopeWorkspace(query),
  );

  summary.verification = {
    campaignsReferencingExampleBrandKits: demoCampaigns.map((row) => String(row.id)),
    creativeRowsStillContainingBase64: creativeRows
      .filter((row) => JSON.stringify(row.canvas_json ?? {}).includes("data:image/"))
      .map((row) => String(row.id)),
  };
}

async function selectAll(table, columns, applyScope) {
  const pageSize = 1000;
  let from = 0;
  const rows = [];

  for (;;) {
    const to = from + pageSize - 1;
    const scoped = applyScope(supabase.from(table).select(columns).range(from, to));
    const { data, error } = await scoped;
    if (error) throw new Error(`Could not read ${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
    from += pageSize;
  }
}

function scopeWorkspace(query) {
  return WORKSPACE_ID ? query.eq("workspace_id", WORKSPACE_ID) : query;
}

function latestApprovedRealKits(brandKits) {
  const result = new Map();
  for (const kit of brandKits) {
    if (kit.review_status !== "approved" || isExampleUrl(kit.source_url)) continue;
    const workspaceId = String(kit.workspace_id);
    const current = result.get(workspaceId);
    if (!current || timestamp(kit) > timestamp(current)) {
      result.set(workspaceId, kit);
    }
  }
  return result;
}

function timestamp(row) {
  return new Date(row.updated_at ?? row.created_at ?? 0).getTime();
}

function normalObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function primaryImageObject(canvas) {
  return Array.isArray(canvas.objects) ? canvas.objects.find((object) => object?.role === "primary_image") : null;
}

function decodeDataUrl(dataUrl) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) throw new Error("Unsupported image data URL.");
  const contentType = match[1].toLowerCase();
  const extension = contentType.includes("png")
    ? "png"
    : contentType.includes("webp")
      ? "webp"
      : contentType.includes("gif")
        ? "gif"
        : "jpg";
  return {
    contentType,
    extension,
    bytes: Buffer.from(match[2], "base64"),
  };
}

function mediaUrl(storagePath) {
  return `/api/adstudio/media?path=${encodeURIComponent(storagePath)}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isExampleUrl(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return false;

  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
    const host = url.hostname.toLowerCase();
    return host === "example" || host.endsWith(".example");
  } catch {
    return /(^|[/:.])example(?:[/?#:]|$)/i.test(text);
  }
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}
