import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdRadarOperator as requireOperator } from "@/lib/operator/auth";
import { isMissingHermesSkillError, readHermesSkill, writeHermesSkill } from "@/lib/operator/hermes-assets";
import { createResearchServiceClient } from "@/lib/research/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const bodySchema = z.object({
  content: z.string().min(1),
});

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const { slug } = await params;
  const loaded = await readSkillForRoute(slug);
  if (!loaded.ok) return loaded.response;
  const skill = loaded.skill;
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode");
  const format = url.searchParams.get("format");

  if (mode === "edit") {
    return new Response(renderEditor(skill, Boolean(process.env.VERCEL)), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (format === "json") {
    return NextResponse.json({ skill });
  }

  return new Response(skill.content, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `inline; filename="${skill.slug}.SKILL.md"`,
    },
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const guard = await requireOperator();
  if (!guard.ok) return guard.response;

  const { slug } = await params;
  const contentType = req.headers.get("content-type") ?? "";
  const rawBody = contentType.includes("application/json")
    ? await req.json().catch(() => ({}))
    : Object.fromEntries((await req.formData()).entries());
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const loaded = await readSkillForRoute(slug);
  if (!loaded.ok) return loaded.response;
  const current = loaded.skill;
  const proposedSha = createHash("sha256").update(parsed.data.content).digest("hex");
  const research = createResearchServiceClient().schema("research");

  if (process.env.VERCEL) {
    await research.from("agent_decisions").insert({
      decision_type: "queue_operation",
      subject_type: "operator_query",
      subject_id: `skill-edit:${slug}:${Date.now()}`,
      decision: {
        action: "skill_edit_requested",
        skill: slug,
        path: current.relativePath,
        current_sha256: current.sha256,
        proposed_sha256: proposedSha,
        proposed_content: parsed.data.content,
        operator: guard.email,
      },
      rationale: "Production Vercel filesystem is read-only; captured operator skill edit request for Git/Hermes review.",
      confidence: 100,
      hermes_skill: "operator-console",
    });

    return NextResponse.json(
      {
        ok: true,
        mode: "edit_request_recorded",
        message: "Production is read-only, so the skill edit was recorded as an operator review request.",
        skill: current,
      },
      { status: 202 },
    );
  }

  const updated = await writeHermesSkill(slug, parsed.data.content);
  await research.from("agent_decisions").insert({
    decision_type: "queue_operation",
    subject_type: "operator_query",
    subject_id: `skill-edit:${slug}:${Date.now()}`,
    decision: {
      action: "skill_file_updated",
      skill: slug,
      path: updated.relativePath,
      previous_sha256: current.sha256,
      new_sha256: updated.sha256,
      operator: guard.email,
    },
    rationale: "Operator updated Hermes skill file through the Research Ops skill editor.",
    confidence: 100,
    hermes_skill: "operator-console",
  });

  return NextResponse.json({ ok: true, mode: "file_updated", skill: updated });
}

async function readSkillForRoute(slug: string) {
  try {
    return { ok: true as const, skill: await readHermesSkill(slug) };
  } catch (error) {
    if (isMissingHermesSkillError(error)) {
      return {
        ok: false as const,
        response: NextResponse.json({ error: "Hermes skill not found." }, { status: 404 }),
      };
    }

    throw error;
  }
}

function renderEditor(skill: Awaited<ReturnType<typeof readHermesSkill>>, productionReadOnly: boolean): string {
  const actionText = productionReadOnly ? "Submit edit request" : "Save skill file";
  const notice = productionReadOnly
    ? "<p>Production runs on Vercel's read-only filesystem. Submitting records a real operator edit request in research.agent_decisions; it does not mutate the deployed file.</p>"
    : "<p>This environment can write to the checked-out SKILL.md file.</p>";

  return `<!doctype html>
<html lang="en-AU">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Edit ${escapeHtml(skill.slug)}</title>
    <style>
      body { margin: 0; background: #f8fafc; color: #131b2e; font-family: Inter, system-ui, sans-serif; }
      main { display: grid; gap: 14px; max-width: 1080px; margin: 0 auto; padding: 24px; }
      header, form, section { border: 1px solid #dfe6f0; border-radius: 8px; background: #fff; padding: 16px; }
      h1 { margin: 0 0 6px; font-size: 24px; }
      p { color: #475569; margin: 0; }
      textarea { width: 100%; min-height: 68vh; box-sizing: border-box; border: 1px solid #dfe6f0; border-radius: 8px; padding: 12px; font: 13px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
      button, a { display: inline-flex; min-height: 38px; align-items: center; border-radius: 8px; padding: 0 14px; font-weight: 700; text-decoration: none; }
      button { border: 1px solid #123e75; background: #123e75; color: #fff; cursor: pointer; }
      a { border: 1px solid #dfe6f0; color: #131b2e; }
      .actions { display: flex; gap: 10px; margin-top: 12px; }
      code { color: #123e75; }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>${escapeHtml(skill.title)}</h1>
        <p><code>${escapeHtml(skill.relativePath)}</code> - ${skill.byteSize} bytes - ${escapeHtml(skill.sha256.slice(0, 12))}</p>
      </header>
      <section>${notice}</section>
      <form method="post">
        <textarea name="content" spellcheck="false">${escapeHtml(skill.content)}</textarea>
        <div class="actions">
          <button type="submit">${actionText}</button>
          <a href="/api/operator/research/skills/${encodeURIComponent(skill.slug)}">Open raw</a>
          <a href="/operator/research#skills">Back to Operator OS</a>
        </div>
      </form>
    </main>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}
