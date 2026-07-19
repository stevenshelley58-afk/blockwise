import { createHash } from "node:crypto";

export const CONTENT_RUN_JOB_TYPE = "blockwise-content-run-orchestrator";

export const CONTENT_STEPS = [
  { skillName: "blockwise-topic-researcher", status: "researching", defaultModelPolicy: "best_reasoning" },
  { skillName: "blockwise-content-strategist", status: "briefing", defaultModelPolicy: "best_reasoning" },
  { skillName: "blockwise-blog-writer", status: "drafting", defaultModelPolicy: "best_copywriting" },
  { skillName: "blockwise-blog-editor", status: "editing", defaultModelPolicy: "critic_review" },
  { skillName: "blockwise-blog-formatter", status: "formatting", defaultModelPolicy: "best_json" },
  { skillName: "blockwise-seo-schema-builder", status: "formatting", defaultModelPolicy: "best_json" },
  { skillName: "blockwise-image-brief-writer", status: "image_prompting", defaultModelPolicy: "best_image_prompting" },
  { skillName: "blockwise-page-builder", status: "page_building", defaultModelPolicy: "code_generation" },
  { skillName: "blockwise-social-post-generator", status: "social_generation", defaultModelPolicy: "best_copywriting" },
  { skillName: "blockwise-lead-ad-generator", status: "ad_generation", defaultModelPolicy: "best_copywriting" },
  { skillName: "blockwise-instant-form-generator", status: "ad_generation", defaultModelPolicy: "best_json" },
  { skillName: "blockwise-compliance-reviewer", status: "compliance_review", defaultModelPolicy: "critic_review" },
  { skillName: "blockwise-agent-reviewer", status: "final_review", defaultModelPolicy: "best_reasoning" },
  { skillName: "blockwise-artifact-packager", status: "final_review", defaultModelPolicy: "best_json" },
];

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";
const DEFAULT_PROMPT_SET_NAME = "default-blockwise-authority-v1";
const DEFAULT_APPROVAL_ACTIONS = ["approve_blog", "approve_images", "approve_social", "approve_ad", "request_changes"];

export async function handleHermesContentRun(job, deps) {
  const contentRunId = job.payload?.contentRunId || job.payload?.content_run_id;
  if (!contentRunId) {
    return {
      status: "blocked",
      blocked_reason: "content_run_id_missing",
      result: { handler: CONTENT_RUN_JOB_TYPE },
    };
  }

  const run = await loadContentRun(deps.rest, contentRunId);
  if (!run) {
    return {
      status: "blocked",
      blocked_reason: "content_run_not_found",
      result: { handler: CONTENT_RUN_JOB_TYPE, content_run_id: contentRunId },
    };
  }

  const fromStep = job.payload?.fromStep || job.payload?.from_step;
  const startIndex = fromStep ? CONTENT_STEPS.findIndex((step) => step.skillName === fromStep) : 0;
  if (startIndex < 0) {
    return {
      status: "blocked",
      blocked_reason: "content_run_invalid_from_step",
      result: { handler: CONTENT_RUN_JOB_TYPE, content_run_id: contentRunId, from_step: fromStep },
    };
  }

  let artifacts = await loadLatestArtifacts(deps.rest, run.id);
  const promptRuns = [];
  const artifactTypes = [];

  try {
    for (const step of CONTENT_STEPS.slice(startIndex)) {
      await patchContentRun(deps.rest, run.id, {
        status: step.status,
        current_step: step.skillName,
        error_message: null,
        updated_at: deps.now(),
        completed_at: null,
      });

      const prompt = await resolvePrompt(deps.rest, run, step);
      const variables = buildPromptVariables(run, artifacts);
      const renderedPrompt = renderPrompt(prompt.templateBody, variables);
      const providerOutput = await executeContentSkill(step.skillName, {
        run,
        artifacts,
        prompt: renderedPrompt,
        modelPolicyId: prompt.modelPolicyId,
        env: deps.env,
        fetchImpl: deps.fetchImpl || fetch,
      });
      const promptHash = hash(renderedPrompt);

      const promptRow = await insertPublic(deps.rest, "prompt_runs", {
        workspace_id: run.workspace_id,
        content_run_id: run.id,
        prompt_template_id: prompt.templateId,
        prompt_version: prompt.promptVersion,
        skill_name: step.skillName,
        resolved_prompt_hash: promptHash,
        provider: providerOutput.provider,
        model_used: providerOutput.model,
        model_policy_id: prompt.modelPolicyId,
        input_json: variables,
        output_json: providerOutput.output,
      });
      promptRuns.push({
        id: promptRow?.id || null,
        skillName: step.skillName,
        provider: providerOutput.provider,
        model: providerOutput.model,
        modelPolicyId: prompt.modelPolicyId,
        promptTemplateId: prompt.templateId,
        promptVersion: prompt.promptVersion,
      });

      for (const artifact of artifactsForContentSkill(step.skillName, providerOutput.output, { artifacts, promptRuns })) {
        artifactTypes.push(artifact.artifactType);
        await insertPublic(deps.rest, "content_artifacts", {
          workspace_id: run.workspace_id,
          content_run_id: run.id,
          artifact_type: artifact.artifactType,
          title: artifact.title,
          status: "generated",
          data_json: artifact.data,
          model_used: providerOutput.model,
          prompt_template_id: prompt.templateId,
          prompt_version: prompt.promptVersion,
        });
        artifacts[artifact.artifactType] = artifact.data;
      }

      await insertPublic(deps.rest, "content_reviews", reviewRowForSkill(run, step.skillName, providerOutput.output));
    }

    await patchContentRun(deps.rest, run.id, {
      status: "waiting_operator_approval",
      current_step: "operator_review",
      error_message: null,
      updated_at: deps.now(),
      completed_at: deps.now(),
    });

    return {
      status: "complete",
      result: {
        handler: CONTENT_RUN_JOB_TYPE,
        content_run_id: run.id,
        artifact_count: artifactTypes.length,
        prompt_run_count: promptRuns.length,
        dry_run: dryRunEnabled(deps.env),
      },
    };
  } catch (error) {
    await patchContentRun(deps.rest, run.id, {
      status: "failed",
      error_message: error.message,
      updated_at: deps.now(),
    });
    throw error;
  }
}

async function loadContentRun(rest, runId) {
  const rows = await rest("public", `content_runs?select=*&id=eq.${encode(runId)}&limit=1`);
  return rows?.[0] || null;
}

async function loadLatestArtifacts(rest, runId) {
  const rows = await rest(
    "public",
    `content_artifacts?select=artifact_type,data_json,created_at&content_run_id=eq.${encode(runId)}&order=created_at.asc&limit=200`,
  );
  const out = {};
  for (const row of rows || []) {
    if (row.artifact_type) out[row.artifact_type] = row.data_json || {};
  }
  return out;
}

async function resolvePrompt(rest, run, step) {
  let promptSetId = run.prompt_set_id;
  if (!promptSetId) {
    const sets = await rest("public", `prompt_sets?select=id&name=eq.${encode(DEFAULT_PROMPT_SET_NAME)}&status=eq.active&limit=1`);
    promptSetId = sets?.[0]?.id || null;
  }

  let item = null;
  if (promptSetId) {
    const items = await rest(
      "public",
      `prompt_set_items?select=prompt_template_id,prompt_version,model_policy_id&prompt_set_id=eq.${encode(promptSetId)}&skill_name=eq.${encode(step.skillName)}&limit=1`,
    );
    item = items?.[0] || null;
  }

  let template = null;
  if (item?.prompt_template_id) {
    const templates = await rest(
      "public",
      `prompt_templates?select=id,key,name,skill_name,template_body,status,version&id=eq.${encode(item.prompt_template_id)}&limit=1`,
    );
    template = templates?.[0] || null;
  }

  if (!template) {
    const templates = await rest(
      "public",
      `prompt_templates?select=id,key,name,skill_name,template_body,status,version&skill_name=eq.${encode(step.skillName)}&status=eq.active&order=version.desc&limit=1`,
    );
    template = templates?.[0] || null;
  }

  if (!template) throw new Error(`No prompt template found for ${step.skillName}`);

  return {
    templateId: template.id,
    promptVersion: Number(item?.prompt_version || template.version || 1),
    templateBody: String(template.template_body || ""),
    modelPolicyId: String(item?.model_policy_id || step.defaultModelPolicy),
  };
}

async function executeContentSkill(skillName, input) {
  if (dryRunEnabled(input.env)) {
    return {
      provider: "deterministic",
      model: "hermes-deterministic-content",
      output: deterministicContentSkillOutput(skillName, input),
    };
  }

  const model = modelForContentSkill(input.env, input.modelPolicyId, skillName);
  const timeoutMs = contentModelTimeoutMs(input.env);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await input.fetchImpl(OPENAI_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requiredOpenAiKey(input.env)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You are a Blockwise Hermes content skill. Return strict JSON only." },
          { role: "user", content: input.prompt },
        ],
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`OpenAI content request timed out after ${timeoutMs}ms for ${skillName}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const raw = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`OpenAI content request failed ${response.status}: ${JSON.stringify(raw).slice(0, 700)}`);
  return {
    provider: "openai",
    model,
    output: parseModelJson(extractContent(raw)),
  };
}

export function modelForContentSkill(env, modelPolicyId, skillName) {
  const configured = parseJsonObject(env.HERMES_CONTENT_MODELS_JSON) || {};
  const model = configured[skillName] || configured[modelPolicyId] || configured.content_generation || env.HERMES_CONTENT_DEFAULT_MODEL || "gpt-5.5";
  return String(model);
}

function requiredOpenAiKey(env) {
  if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured for Hermes content generation");
  return env.OPENAI_API_KEY;
}

function dryRunEnabled(env) {
  return /^(1|true|yes)$/iu.test(String(env.HERMES_CONTENT_DRY_RUN || env.CONTENT_ENGINE_DRY_RUN || ""));
}

function contentModelTimeoutMs(env) {
  const configured = Number.parseInt(String(env.HERMES_CONTENT_MODEL_TIMEOUT_MS || ""), 10);
  if (Number.isFinite(configured) && configured >= 1000) return configured;
  return 90000;
}

function extractContent(raw) {
  const choices = raw?.choices;
  const content = Array.isArray(choices) ? choices[0]?.message?.content : "";
  return typeof content === "string" ? content : "";
}

function parseModelJson(content) {
  const trimmed = content.trim().replace(/^```(?:json)?/iu, "").replace(/```$/u, "").trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("model output was not a JSON object");
    return parsed;
  } catch (error) {
    throw new Error(`Content model returned invalid JSON: ${error.message}`);
  }
}

function buildPromptVariables(run, artifacts) {
  return {
    ...safeObject(run.input_json),
    topic: run.topic,
    target_audience: run.target_audience,
    business_goal: run.business_goal,
    content_angle: run.content_angle,
    offer: run.offer,
    cta: run.primary_cta,
    primary_cta: run.primary_cta,
    model_policy_id: run.model_policy_id,
    brand_voice: safeObject(run.input_json).tone_profile || "direct, expert, no hype",
    research_summary: artifacts.research_brief?.research_summary || "",
    strategy_brief: artifacts.strategy_brief || {},
    blog_draft: artifacts.blog_draft || {},
    blog_final: artifacts.blog_final || {},
    edited_markdown: artifacts.blog_final?.edited_markdown || "",
    formatted_page: artifacts.formatted_page || {},
    image_slots: artifacts.formatted_page?.image_slots || [],
    seo_schema: artifacts.seo_schema || {},
    instant_form: artifacts.instant_form || {},
    artifact_package: artifacts,
  };
}

function renderPrompt(template, variables) {
  return String(template).replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/gu, (_match, key) => stringifyPromptValue(valueForPath(variables, key)));
}

function valueForPath(source, key) {
  return String(key).split(".").reduce((value, segment) => value?.[segment], source);
}

function stringifyPromptValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

export function artifactsForContentSkill(skillName, output, context = {}) {
  switch (skillName) {
    case "blockwise-topic-researcher":
      return [{ artifactType: "research_brief", title: "Research brief", data: output }];
    case "blockwise-content-strategist":
      return [{ artifactType: "strategy_brief", title: String(output.blog_title || "Strategy brief"), data: output }];
    case "blockwise-blog-writer":
      return [{ artifactType: "blog_draft", title: String(output.title || "Blog draft"), data: output }];
    case "blockwise-blog-editor":
      return [{ artifactType: "blog_final", title: "Edited blog", data: output }];
    case "blockwise-blog-formatter":
      return [{ artifactType: "formatted_page", title: String(output.page_title || "Formatted page"), data: output }];
    case "blockwise-seo-schema-builder":
      return [{ artifactType: "seo_schema", title: "SEO schema", data: output }];
    case "blockwise-image-brief-writer":
      return [{ artifactType: "image_prompt", title: "Image prompt pack", data: output }];
    case "blockwise-page-builder":
      return [{ artifactType: "formatted_page", title: "Draft page package", data: output }];
    case "blockwise-social-post-generator":
      return [
        { artifactType: "social_facebook", title: "Facebook post", data: safeObject(output.facebook_post) },
        { artifactType: "social_instagram", title: "Instagram post and story", data: { instagram_post: output.instagram_post || {}, instagram_story: output.instagram_story || {}, linkedin_optional: output.linkedin_optional || {} } },
      ];
    case "blockwise-lead-ad-generator":
      return [{ artifactType: "lead_ad", title: "Meta lead ad package", data: output }];
    case "blockwise-instant-form-generator":
      return [{ artifactType: "instant_form", title: "Instant Form draft", data: output }];
    case "blockwise-compliance-reviewer":
      return [{ artifactType: "compliance_report", title: "Compliance report", data: output }];
    case "blockwise-agent-reviewer":
      return [{ artifactType: "review_report", title: "Agent review report", data: output }];
    case "blockwise-artifact-packager":
      return [{ artifactType: "artifact_package", title: "Publishing-ready artifact package", data: normalizeArtifactPackage(output, context) }];
    default:
      return [];
  }
}

function normalizeArtifactPackage(output, context) {
  const data = safeObject(output);
  const promptRuns = Array.isArray(context.promptRuns) ? context.promptRuns : [];
  return {
    ...data,
    approval_actions: nonEmptyArray(data.approval_actions) ? data.approval_actions : DEFAULT_APPROVAL_ACTIONS,
    prompt_versions_used: nonEmptyArray(data.prompt_versions_used) ? data.prompt_versions_used : promptRuns.map(promptRunProvenance),
    models_used: nonEmptyArray(data.models_used) ? data.models_used : promptRuns.map(modelProvenance),
  };
}

function promptRunProvenance(row) {
  return {
    skill_name: row.skillName || null,
    prompt_template_id: row.promptTemplateId || null,
    prompt_version: row.promptVersion || null,
    model_policy_id: row.modelPolicyId || null,
    provider: row.provider || null,
    model_used: row.model || null,
  };
}

function modelProvenance(row) {
  return {
    skill_name: row.skillName || null,
    provider: row.provider || null,
    model_used: row.model || null,
    model_policy_id: row.modelPolicyId || null,
  };
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function reviewRowForSkill(run, skillName, output) {
  const score = typeof output.overall_score === "number" ? output.overall_score : typeof output.strength_score === "number" ? output.strength_score : null;
  let status = "pass";
  if (output.recommendation === "reject" || output.status === "fail") status = "fail";
  if (output.recommendation === "revise" || output.status === "needs_human") status = "needs_human";
  return {
    workspace_id: run.workspace_id,
    content_run_id: run.id,
    review_type: skillName,
    reviewer_type: "ai",
    score,
    status,
    issues_json: output.issues || output.risk_flags || output.required_edits || [],
    required_changes_json: output.required_changes || output.required_edits || [],
  };
}

async function patchContentRun(rest, runId, patch) {
  await rest("public", `content_runs?id=eq.${encode(runId)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

async function insertPublic(rest, table, row) {
  const rows = await rest("public", table, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(row),
  });
  return rows?.[0] || null;
}

export function deterministicContentSkillOutput(skillName, input) {
  const run = input.run;
  const topic = run.topic;
  const cta = run.primary_cta || "Book a Blockwise demo";
  const offer = run.offer || "Free Blockwise Seller Lead Audit";
  const slug = slugify(topic);

  switch (skillName) {
    case "blockwise-topic-researcher":
      return {
        research_summary: `${topic} should be framed around lead quality, signal quality, follow-up, and outcome tracking for Australian real estate agents.`,
        source_claims: [{ claim: "Lead quality improves when campaigns optimise toward qualified outcomes instead of raw form volume.", source_type: "official_docs", confidence: "medium" }],
        must_include_points: ["Value-first lead magnet", "Qualified lead signal", "CRM outcome feedback", "Retargeting loop"],
        do_not_claim: ["Guaranteed listings", "Guaranteed lead volume", "Unsupported performance statistics"],
        open_questions: [],
      };
    case "blockwise-content-strategist":
      return {
        blog_title: topic,
        slug,
        search_intent: "Agents trying to understand why Meta leads are cheap but commercially weak.",
        reader_problem: "They receive enquiries that do not become appraisals or listings.",
        core_argument: "The system is optimising toward the easiest form submit instead of the most useful business signal.",
        blockwise_point_of_view: "Lead generation works when content, offer, form quality, follow-up, and outcome feedback are designed as one loop.",
        cta,
        lead_magnet: offer,
        article_outline: ["What agents usually get wrong", "Why Meta behaves this way", "The better system", "The Blockwise framework"],
      };
    case "blockwise-blog-writer":
      return {
        title: topic,
        subtitle: "Most agents do not have a lead volume problem. They have a signal problem.",
        intro: "A low CPL can look good in a report while the sales team wastes time on people who never become appraisals.",
        body_markdown: `# ${topic}\n\nMost real estate agents judge Meta campaigns too early and on the wrong metric. A form submit is not a listing opportunity.\n\n## What usually goes wrong\nAgents often optimise for cheap enquiries, broad offers, and fast form volume.\n\n## The Blockwise framework\nBlockwise connects the article, offer, instant form, lead inbox, qualification status, and follow-up action.`,
        conclusion: "The better question is how to build a system that helps the platform and team recognise useful leads.",
        cta_block: `${offer}: ${cta}.`,
        meta_description: "Why real estate agents get weak Meta leads, and how Blockwise connects content, forms, follow-up, and qualified signals.",
        excerpt: "Cheap Meta leads are not useful unless the system qualifies, follows up, and feeds back the right outcome signal.",
      };
    case "blockwise-blog-editor":
      return {
        edited_markdown: input.artifacts.blog_draft?.body_markdown || "",
        change_summary: ["Kept claims conservative.", "Made the CTA direct.", "Preserved the practical framework."],
        risk_flags: [],
        claim_flags: [],
        suggested_cut_lines: [],
        strength_score: 88,
      };
    case "blockwise-blog-formatter":
      return {
        page_title: topic,
        slug,
        seo_title: `${topic} | Blockwise`,
        meta_description: "A practical framework for improving real estate Meta lead quality.",
        content_blocks: [
          { type: "hero", content: { title: topic, subtitle: "A practical Blockwise framework for qualified lead generation." } },
          { type: "markdown_section", content: { markdown: input.artifacts.blog_final?.edited_markdown || "" } },
          { type: "cta_band", content: { headline: offer, cta } },
        ],
        image_slots: [{ slot: "hero", purpose: "Visualise wrong signal vs qualified signal" }],
      };
    case "blockwise-seo-schema-builder":
      return {
        seo_title: `${topic} | Blockwise`,
        meta_description: "A practical Blockwise guide to improving real estate Meta lead quality.",
        canonical: `https://blockwise.sale/blog/${slug}`,
        schema_json_ld: { "@context": "https://schema.org", "@type": "Article", headline: topic, publisher: { "@type": "Organization", name: "Blockwise" } },
        faq_schema: [],
      };
    case "blockwise-image-brief-writer":
      return {
        image_briefs: [{ slot: "hero", aspect_ratio: "16:9", prompt: "Premium SaaS dashboard abstraction showing weak signal becoming qualified outcome feedback.", negative_prompt: "No fake logos, no readable fake UI text, no AI people.", alt_text: "Abstract lead quality signal flow for a real estate Meta ads audit." }],
      };
    case "blockwise-page-builder":
      return { page_path: `/blog/${slug}`, preview_url: `/operator/content-runs/${run.id || "draft"}#blog-preview`, status: "draft", build_notes: ["Hermes generated draft page data only."] };
    case "blockwise-social-post-generator":
      return {
        facebook_post: { copy: `${topic}\n\nMost agents are not short on leads. They are short on qualified signals.`, link_url: `/blog/${slug}`, cta: "Read the full breakdown" },
        instagram_post: { caption: "Cheap leads are not always good leads. The signal you feed Meta matters.", hashtags: ["#realestateagents", "#metaads", "#sellerleads"] },
        instagram_story: { frames: [{ frame: 1, text: "Your CPL is not the whole problem." }, { frame: 2, text: offer }] },
      };
    case "blockwise-lead-ad-generator":
      return {
        campaign_brief: { objective: "Leads", offer, audience: run.target_audience, angle: "Your Meta ads may be optimising for the wrong signal" },
        ad_variants: ["Wrong signal", "Cheap lead problem", "Boosted post problem", "Follow-up leak", "Attribution ROI"].map((name) => ({ variant_name: name, primary_text: "If your Meta leads are cheap but not turning into appraisals, the campaign may be optimising for the wrong signal.", headline: "Get a seller lead audit", cta: "Book Now" })),
        compliance_notes: [],
      };
    case "blockwise-instant-form-generator":
      return {
        headline: offer,
        intro: "We will review how your Meta ads, lead forms, follow-up, and tracking are set up.",
        questions: ["Are you currently running Meta ads?", "What is your biggest issue?", "Would you like us to review your current setup?"],
        contact_fields: ["Full name", "Email", "Phone", "Agency name"],
        lead_scoring: { hot: "Running ads and wants review", warm: "Interested but not ready", nurture: "Researching" },
      };
    case "blockwise-compliance-reviewer":
      return { status: "pass", risk_level: "low", issues: [], required_changes: [], approval_blockers: [] };
    case "blockwise-agent-reviewer":
      return { overall_score: 88, recommendation: "approve", best_assets: ["Blog framework", "Lead audit CTA"], weak_assets: [], required_edits: [], final_summary_for_operator: "Draft package is ready for operator review." };
    case "blockwise-artifact-packager":
      return {
        blog: { title: topic, preview_url: `/operator/content-runs/${run.id || "draft"}#blog-preview`, markdown: input.artifacts.blog_final?.edited_markdown || "", seo: input.artifacts.seo_schema || {} },
        images: input.artifacts.image_prompt?.image_briefs || [],
        social_posts: { facebook: input.artifacts.social_facebook, instagram: input.artifacts.social_instagram },
        lead_ad: input.artifacts.lead_ad || {},
        instant_form: input.artifacts.instant_form || {},
        approval_actions: ["approve_blog", "approve_images", "approve_social", "approve_ad", "request_changes"],
      };
    default:
      return {};
  }
}

export function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 80) || "blockwise-content-run";
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function parseJsonObject(value) {
  if (!value || !String(value).trim()) return null;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function encode(value) {
  return encodeURIComponent(String(value));
}
