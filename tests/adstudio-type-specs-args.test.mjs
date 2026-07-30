import assert from "node:assert/strict";
import test from "node:test";

import {
  parseArgs,
  selectTemplateFiles,
} from "../scripts/build/font-corpus/type-specs-args.mjs";

test("type-spec build accepts repeatable comma-separated template batches", () => {
  const options = parseArgs([
    "--regions-only",
    "--template", "meta-feed-018,meta-story-018",
    "--template=meta-feed-019",
  ]);
  assert.equal(options.regionsOnly, true);
  assert.deepEqual([...options.templateIds].sort(), ["meta-feed-018", "meta-feed-019", "meta-story-018"]);
  assert.deepEqual(
    selectTemplateFiles(["meta-feed-018.json", "meta-feed-019.json", "meta-story-018.json"], options.templateIds),
    ["meta-feed-018.json", "meta-feed-019.json", "meta-story-018.json"],
  );
});

test("type-spec build rejects an accidental unknown batch member before it can write", () => {
  const options = parseArgs(["--template", "meta-feed-018,meta-missing"]);
  assert.throws(
    () => selectTemplateFiles(["meta-feed-018.json"], options.templateIds),
    /Unknown template id\(s\): meta-missing/u,
  );
});
