import type { ContentSkillName, CreateContentRunInput } from "./contracts.ts";

type SkillInput = {
  run: CreateContentRunInput & { id?: string };
  artifacts: Record<string, unknown>;
};

export function deterministicContentSkillOutput(skillName: ContentSkillName, input: SkillInput): Record<string, unknown> {
  const topic = input.run.topic;
  const slug = slugify(topic);
  const cta = input.run.primary_cta || "Book a Blockwise demo";
  const offer = input.run.offer || "Free Blockwise Seller Lead Audit";

  switch (skillName) {
    case "blockwise-topic-researcher":
      return {
        research_summary: `${topic} should be framed around lead quality, signal quality, follow-up, and outcome tracking for Australian agents.`,
        source_claims: [
          {
            claim: "Lead quality improves when campaigns optimise toward qualified outcomes instead of raw form volume.",
            source_url: "https://www.facebook.com/business/help/3373123166040766",
            source_type: "official_docs",
            confidence: "high",
          },
        ],
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
        meta_ad_angle: "Your Meta ads may be optimising for the wrong signal.",
        social_angle: "Cheap leads are expensive when no one qualifies or follows up.",
        article_outline: [
          { heading: "What agents usually get wrong", purpose: "Name the decision trap." },
          { heading: "Why Meta behaves this way", purpose: "Explain optimisation without jargon." },
          { heading: "The better system", purpose: "Show the content-to-lead chain." },
          { heading: "The Blockwise framework", purpose: "Make the product point of view concrete." },
        ],
        funnel_mapping: {
          blog: "Authority article explains the wrong-signal problem.",
          lead_magnet: offer,
          instant_form: "Higher-intent form qualifies current ads, main issue, role, and review intent.",
          ad: "Meta lead campaign points agents to the audit offer.",
          follow_up: "Hot leads book a demo; warm leads receive checklist and nurture.",
        },
      };
    case "blockwise-blog-writer":
      return {
        title: topic,
        subtitle: "Most agents do not have a lead volume problem. They have a signal problem.",
        intro: "A low CPL can look good in a report while the sales team wastes time on people who never become appraisals.",
        body_markdown: [
          `# ${topic}`,
          "",
          "Most real estate agents judge Meta campaigns too early and on the wrong metric. A form submit is not a listing opportunity. It is only the first signal.",
          "",
          "## What usually goes wrong",
          "Agents often optimise for cheap enquiries, broad offers, and fast form volume. That teaches the platform to find people who complete forms, not necessarily people who are ready to talk about selling.",
          "",
          "## Why the platform behaves this way",
          "Meta follows the conversion signal it receives. If every form submit looks equally valuable, the platform has little reason to distinguish a serious appraisal opportunity from a weak enquiry.",
          "",
          "## A better system",
          "| Layer | Weak setup | Better setup |",
          "| --- | --- | --- |",
          "| Content | Generic agency post | Expert article with a clear point of view |",
          "| Offer | Vague callback | Specific audit or checklist |",
          "| Form | Name and phone only | Qualification questions that separate hot, warm, and nurture leads |",
          "| Follow-up | Manual chasing | Clear next step by lead intent |",
          "| Feedback | No outcome data | Qualified lead and booked appraisal signals |",
          "",
          "## The Blockwise framework",
          "Blockwise connects the article, offer, instant form, lead inbox, qualification status, and follow-up action so the campaign is built around commercial outcomes instead of isolated clicks.",
        ].join("\n"),
        conclusion: "The better question is not how to get cheaper leads. It is how to build a system that helps the platform and the team recognise useful leads.",
        cta_block: `${offer}: ${cta}.`,
        meta_description: "Why real estate agents get weak Meta leads, and how Blockwise connects content, forms, follow-up, and qualified signals.",
        excerpt: "Cheap Meta leads are not useful unless the system qualifies, follows up, and feeds back the right outcome signal.",
      };
    case "blockwise-blog-editor":
      return {
        edited_markdown: String((input.artifacts.blog_draft as { body_markdown?: string } | undefined)?.body_markdown ?? ""),
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
        open_graph_title: topic,
        open_graph_description: "A Blockwise framework for turning authority content into qualified agent leads.",
        content_blocks: [
          { type: "hero", content: { title: topic, subtitle: "A practical Blockwise framework for qualified lead generation." } },
          { type: "markdown_section", content: { markdown: (input.artifacts.blog_final as { edited_markdown?: string } | undefined)?.edited_markdown ?? "" } },
          { type: "cta_band", content: { headline: offer, cta } },
        ],
        internal_links: ["/ad-studio", "/monitor", "/leads"],
        image_slots: [
          { slot: "hero", purpose: "Visualise wrong signal vs qualified signal" },
          { slot: "inline_1", purpose: "Campaign flow diagram" },
          { slot: "social_preview", purpose: "Square post graphic" },
        ],
      };
    case "blockwise-seo-schema-builder":
      return {
        seo_title: `${topic} | Blockwise`,
        meta_description: "A practical Blockwise guide to improving real estate Meta lead quality.",
        canonical: `https://blockwise.sale/blog/${slug}`,
        og_image: `/images/blog/${slug}/hero.png`,
        schema_json_ld: {
          "@context": "https://schema.org",
          "@type": "Article",
          headline: topic,
          publisher: { "@type": "Organization", name: "Blockwise" },
        },
        faq_schema: [],
      };
    case "blockwise-image-brief-writer":
      return {
        image_briefs: [
          {
            slot: "hero",
            asset_type: "blog_hero",
            aspect_ratio: "16:9",
            prompt: "Premium SaaS dashboard abstraction showing a weak signal path turning into qualified outcome feedback.",
            negative_prompt: "No people, no fake logos, no fake UI text, no clutter.",
            style_tokens: ["deep navy", "off-white", "muted blue", "soft grey"],
            must_include: ["signal flow", "clean cards", "audit motif"],
            must_avoid: ["Meta logo", "readable fake text", "AI people"],
            alt_text: "Abstract lead quality signal flow for a real estate Meta ads audit.",
          },
        ],
      };
    case "blockwise-page-builder":
      return {
        page_path: `/blog/${slug}`,
        page_component_path: null,
        preview_url: `/operator/content-runs/${input.run.id ?? "draft"}#blog-preview`,
        status: "draft",
        build_notes: ["Phase 1 creates draft page data only. No public page was published."],
      };
    case "blockwise-social-post-generator":
      return {
        facebook_post: {
          copy: `${topic}\n\nMost agents are not short on leads. They are short on qualified signals.\n\nRead the full Blockwise breakdown and book the audit if you want your setup reviewed.`,
          image_asset: "social_preview",
          link_url: `/blog/${slug}`,
          cta: "Read the full breakdown",
        },
        instagram_post: {
          caption: "Cheap leads are not always good leads. The signal you feed Meta matters. Read the Blockwise breakdown or ask for the audit.",
          image_asset: "social_preview",
          hashtags: ["#realestateagents", "#metaads", "#sellerleads"],
          cta: "Comment AUDIT or tap link in bio",
        },
        instagram_story: {
          frames: [
            { frame: 1, text: "Your CPL is not the whole problem." },
            { frame: 2, text: "Meta optimises toward the signal you give it." },
            { frame: 3, text: offer },
          ],
        },
        linkedin_optional: {
          copy: "A practical look at why real estate Meta campaigns need qualified outcome signals, not just form volume.",
        },
      };
    case "blockwise-lead-ad-generator":
      return {
        campaign_brief: {
          objective: "Leads",
          offer,
          audience: input.run.target_audience,
          angle: "Your Meta ads may be optimising for the wrong signal",
        },
        ad_variants: [
          "Wrong signal angle",
          "Cheap lead problem angle",
          "Boosted post problem angle",
          "Follow-up leak angle",
          "Attribution ROI angle",
        ].map((name) => ({
          variant_name: name,
          primary_text: "If your Meta leads are cheap but not turning into appraisals, the campaign may be optimising for the wrong signal.",
          headline: "Get a seller lead audit",
          description: "Blockwise reviews your ads, forms, follow-up, and tracking.",
          cta: "Book Now",
          creative_asset: "ad_creative_4x5",
          form_id: null,
          campaign_name: "Blockwise Seller Lead Audit",
          ad_set_notes: "Draft-only package. Operator approval required before any live campaign work.",
          compliance_notes: [],
        })),
        instant_form: {},
        lead_scoring: {},
        compliance_notes: [],
      };
    case "blockwise-instant-form-generator":
      return {
        headline: offer,
        intro: "We will review how your Meta ads, lead forms, follow-up, and tracking are set up, then show where leads are leaking.",
        questions: [
          { label: "Are you currently running Meta ads?", options: ["Yes, actively", "Sometimes / boosted posts", "Not currently", "Agency runs them for me"] },
          { label: "What is your biggest issue?", options: ["Leads are low quality", "Leads are too expensive", "Leads do not turn into appraisals", "I do not know what is working"] },
          { label: "Would you like us to review your current setup?", options: ["Yes, book a demo", "Yes, send me the audit info", "Not yet, just researching"] },
        ],
        contact_fields: ["Full name", "Email", "Phone", "Agency name", "Website optional"],
        lead_scoring: {
          hot: "Running ads + low quality/no appraisals + wants review",
          warm: "Boosting posts or agency runs ads + wants more listing opportunities",
          nurture: "Not running ads + researching",
        },
        completion_paths: {
          hot: "Book your Blockwise demo",
          warm: "Get the audit checklist + optional demo",
          nurture: "Read the guide + join updates",
        },
      };
    case "blockwise-compliance-reviewer":
      return {
        status: "pass",
        risk_level: "low",
        issues: [],
        required_changes: [],
        approval_blockers: [],
      };
    case "blockwise-agent-reviewer":
      return {
        overall_score: 88,
        recommendation: "approve",
        best_assets: ["Blog framework", "Lead audit CTA", "Wrong signal ad angle"],
        weak_assets: [],
        required_edits: [],
        optional_edits: ["Add internal links once the public blog library grows."],
        final_summary_for_operator: "Draft package is commercially coherent and ready for operator review.",
      };
    case "blockwise-artifact-packager":
      return {
        blog: {
          title: topic,
          preview_url: `/operator/content-runs/${input.run.id ?? "draft"}#blog-preview`,
          markdown: (input.artifacts.blog_final as { edited_markdown?: string } | undefined)?.edited_markdown ?? "",
          seo: input.artifacts.seo_schema ?? {},
        },
        images: (input.artifacts.image_prompt as { image_briefs?: unknown[] } | undefined)?.image_briefs ?? [],
        social_posts: {
          facebook: input.artifacts.social_facebook,
          instagram: input.artifacts.social_instagram,
        },
        lead_ad: input.artifacts.lead_ad ?? {},
        instant_form: input.artifacts.instant_form ?? {},
        review_report: input.artifacts.review_report ?? {},
        prompt_versions_used: [],
        models_used: [],
        approval_actions: ["approve_blog", "approve_images", "approve_social", "approve_ad", "request_changes"],
      };
    default:
      return {};
  }
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "")
    .slice(0, 80) || "blockwise-content-run";
}

