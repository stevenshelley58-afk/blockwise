import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { creativeSkeletonSchema, creativeSkeletonArchetypeSchema } from "../src/lib/ad-template-library/skeleton.ts";
import {
  CURATED_TEMPLATE_SAMPLE_STYLES,
  ARCHETYPE_ALLOWED_LAYOUTS,
} from "../src/lib/adstudio/template-sample-styles.generated.ts";

const seed = JSON.parse(readFileSync("ad-template-library/library-seed.json", "utf8")) as {
  templates: Array<{ template_key: string; creative_skeleton?: unknown }>;
};
const VALID_ARCHETYPES = new Set(creativeSkeletonArchetypeSchema.options);

test("every curated preview layout is faithful to its archetype", () => {
  for (const [key, style] of Object.entries(CURATED_TEMPLATE_SAMPLE_STYLES)) {
    assert.ok(VALID_ARCHETYPES.has(style.archetype as never), `${key}: unknown archetype ${style.archetype}`);
    const allowed = ARCHETYPE_ALLOWED_LAYOUTS[style.archetype];
    assert.ok(allowed, `${key}: no allowed-layouts for ${style.archetype}`);
    assert.ok(
      allowed.includes(style.layout),
      `${key}: preview layout "${style.layout}" is not faithful to archetype "${style.archetype}"`,
    );
  }
});

test("every template has a schema-valid creative_skeleton", () => {
  for (const template of seed.templates) {
    const parsed = creativeSkeletonSchema.safeParse(template.creative_skeleton);
    assert.ok(parsed.success, `${template.template_key}: invalid creative_skeleton ${JSON.stringify(parsed.error?.issues?.[0])}`);
  }
});

test("preview archetype and real skeleton archetype agree (no drift)", () => {
  for (const template of seed.templates) {
    const style = CURATED_TEMPLATE_SAMPLE_STYLES[template.template_key];
    assert.ok(style, `${template.template_key}: missing curated style`);
    const skeletonArchetype = (template.creative_skeleton as { archetype?: string } | undefined)?.archetype;
    assert.equal(
      skeletonArchetype,
      style.archetype,
      `${template.template_key}: preview archetype "${style.archetype}" != skeleton archetype "${skeletonArchetype}"`,
    );
  }
});
