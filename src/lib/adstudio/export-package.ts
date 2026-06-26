import type { AdStudioCampaignPack, AdStudioExportPackage, AdStudioExportManifest } from "./types.ts";
import {
  buildRenderMap,
  decodeCreativeRender,
  findCreativeRender,
  type CreativeExportRender,
} from "./creative-export.ts";
import { deterministicUuid } from "./id.ts";
import { svgToBytes } from "./creative-svg.ts";

type FileInput = {
  path: string;
  mimeType: string;
  bytes: Uint8Array;
};

const TEXT_ENCODER = new TextEncoder();

export async function buildAdStudioExportPackage(
  pack: AdStudioCampaignPack,
  options: { creativeRenders?: CreativeExportRender[] } = {},
): Promise<AdStudioExportPackage> {
  const files = buildExportFiles(pack, options);
  const manifest: AdStudioExportManifest = {
    exportId: deterministicUuid(`export:${pack.campaign.campaignId}`),
    campaignId: pack.campaign.campaignId,
    generatedAt: new Date().toISOString(),
    files: files.map((file) => ({
      path: file.path,
      mimeType: file.mimeType,
      bytes: file.bytes.byteLength,
    })),
    platforms: pack.campaign.platforms,
  };
  const filesWithManifest = [
    ...files,
    {
      path: "manifest.json",
      mimeType: "application/json",
      bytes: textBytes(JSON.stringify(manifest, null, 2)),
    },
  ];
  const fileMap = Object.fromEntries(filesWithManifest.map((file) => [file.path, file.bytes]));

  return {
    manifest: {
      ...manifest,
      files: filesWithManifest.map((file) => ({
        path: file.path,
        mimeType: file.mimeType,
        bytes: file.bytes.byteLength,
      })),
    },
    files: fileMap,
    zipBytes: createZip(filesWithManifest),
  };
}

function buildExportFiles(
  pack: AdStudioCampaignPack,
  options: { creativeRenders?: CreativeExportRender[] },
): FileInput[] {
  const primaryCopy = pack.copyPacks[0];
  const renderMap = buildRenderMap(options.creativeRenders);
  const files: FileInput[] = [];

  if (!primaryCopy) {
    throw new Error("Campaign pack has no copy packs to export.");
  }

  const exportVariantId = primaryCopy.variantId;
  const creativesByFormat = new Map(
    pack.creatives
      .filter((creative) => creative.variantId === exportVariantId)
      .map((creative) => [creative.format, creative]),
  );

  addCreative(files, "meta/feed_1x1.png", creativesByFormat.get("1:1"), renderMap, "image/png");
  addCreative(files, "meta/feed_1x1.jpg", creativesByFormat.get("1:1"), renderMap, "image/jpeg");
  addCreative(files, "meta/feed_4x5.png", creativesByFormat.get("4:5"), renderMap, "image/png");
  addCreative(files, "meta/feed_4x5.jpg", creativesByFormat.get("4:5"), renderMap, "image/jpeg");
  addCreative(files, "meta/story_9x16.png", creativesByFormat.get("9:16"), renderMap, "image/png");
  addCreative(files, "meta/story_9x16.jpg", creativesByFormat.get("9:16"), renderMap, "image/jpeg");
  files.push(jsonFile("meta/copy.json", primaryCopy.meta));
  files.push(jsonFile("meta/lead_form.json", primaryCopy.meta.leadForm));
  if (pack.campaign.platforms.includes("google_search")) {
    files.push(textFile("google-search/responsive_search_ads.csv", googleSearchCsv(primaryCopy.googleSearch)));
    files.push(textFile("google-search/keywords.csv", primaryCopy.googleSearch.keywords.join("\n")));
    files.push(textFile("google-search/negative_keywords.csv", primaryCopy.googleSearch.negativeKeywords.join("\n")));
  }
  if (pack.campaign.platforms.includes("google_pmax")) {
    addCreative(files, "google-pmax/landscape_1_91.png", creativesByFormat.get("1.91:1"), renderMap, "image/png");
    addCreative(files, "google-pmax/square_1_1.png", creativesByFormat.get("1:1"), renderMap, "image/png");
    addCreative(files, "google-pmax/portrait_4_5.png", creativesByFormat.get("4:5"), renderMap, "image/png");
    files.push(jsonFile("google-pmax/copy.json", primaryCopy.googlePmax));
  }
  if (pack.campaign.platforms.includes("google_demand_gen")) {
    addCreative(files, "demand-gen/square_1_1.png", creativesByFormat.get("1:1"), renderMap, "image/png");
    addCreative(files, "demand-gen/portrait_4_5.png", creativesByFormat.get("4:5"), renderMap, "image/png");
    addCreative(files, "demand-gen/vertical_9_16.png", creativesByFormat.get("9:16"), renderMap, "image/png");
    files.push(jsonFile("demand-gen/copy.json", primaryCopy.googleDemandGen));
  }
  files.push(jsonFile("landing-page/landing_copy.json", primaryCopy.landingPage));
  files.push(textFile("follow-up/sms_sequence.txt", primaryCopy.followUp.sms.join("\n\n")));
  files.push(
    textFile(
      "follow-up/email_sequence.txt",
      primaryCopy.followUp.email.map((email) => `Subject: ${email.subject}\n\n${email.body}`).join("\n\n---\n\n"),
    ),
  );
  files.push(jsonFile("compliance/compliance_report.json", pack.compliance));
  files.push({
    path: "compliance/compliance_report.pdf",
    mimeType: "application/pdf",
    bytes: minimalPdfBytes(`AdStudio compliance report\nStatus: ${pack.compliance.status}\nIssues: ${pack.compliance.issues.length}`),
  });

  return files;
}

function addCreative(
  files: FileInput[],
  path: string,
  creative: (AdStudioCampaignPack["creatives"][number] & { previewSvg: string }) | undefined,
  renderMap: Map<string, CreativeExportRender>,
  mimeType: CreativeExportRender["mimeType"],
) {
  const render = findCreativeRender(renderMap, creative, mimeType);

  if (creative && render) {
    files.push({
      path,
      mimeType,
      bytes: decodeCreativeRender(render, creative),
    });
    return;
  }

  // Rasterization not yet implemented — SVG written with correct extension
  files.push({
    path: path.replace(/\.(png|jpg|jpeg)$/i, ".svg"),
    mimeType: "image/svg+xml",
    bytes: svgToBytes(creative?.previewSvg ?? "<svg xmlns=\"http://www.w3.org/2000/svg\"/>"),
  });
}

function jsonFile(path: string, value: unknown): FileInput {
  return {
    path,
    mimeType: "application/json",
    bytes: textBytes(JSON.stringify(value, null, 2)),
  };
}

function textFile(path: string, value: string): FileInput {
  return {
    path,
    mimeType: "text/plain",
    bytes: textBytes(value),
  };
}

function googleSearchCsv(pack: { headlines: string[]; descriptions: string[]; finalUrl: string; paths: string[] }) {
  return [
    ["Final URL", "Headlines", "Descriptions", "Path 1", "Path 2"].join(","),
    [
      csv(pack.finalUrl),
      csv(pack.headlines.join(" | ")),
      csv(pack.descriptions.join(" | ")),
      csv(pack.paths[0] ?? ""),
      csv(pack.paths[1] ?? ""),
    ].join(","),
  ].join("\n");
}

function csv(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function textBytes(value: string): Uint8Array {
  return TEXT_ENCODER.encode(value);
}

function minimalPdfBytes(text: string): Uint8Array {
  const escaped = text.replace(/[()\\]/g, "\\$&").replace(/\n/g, ") Tj T* (");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
    `4 0 obj << /Length ${escaped.length + 48} >> stream\nBT /F1 12 Tf 72 720 Td (${escaped}) Tj ET\nendstream endobj`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];

  for (const object of objects) {
    offsets.push(body.length);
    body += `${object}\n`;
  }

  const xrefOffset = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  body += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return textBytes(body);
}

function createZip(files: FileInput[]): Uint8Array {
  const chunks: Uint8Array[] = [];
  const centralDirectory: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = textBytes(file.path);
    const crc = crc32(file.bytes);
    const localHeader = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(file.bytes.byteLength),
      u32(file.bytes.byteLength),
      u16(nameBytes.byteLength),
      u16(0),
      nameBytes,
    ]);
    chunks.push(localHeader, file.bytes);
    centralDirectory.push(
      concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(file.bytes.byteLength),
        u32(file.bytes.byteLength),
        u16(nameBytes.byteLength),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes,
      ]),
    );
    offset += localHeader.byteLength + file.bytes.byteLength;
  }

  const centralStart = offset;
  const centralBytes = concat(centralDirectory);
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralBytes.byteLength),
    u32(centralStart),
    u16(0),
  ]);

  return concat([...chunks, centralBytes, end]);
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output;
}

function u16(value: number): Uint8Array {
  const bytes = new Uint8Array(2);
  new DataView(bytes.buffer).setUint16(0, value, true);
  return bytes;
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;

  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}
