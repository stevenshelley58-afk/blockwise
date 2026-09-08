import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { WORKFLOW_PHASES, WORKFLOW_STEP_STARTS, WORKFLOW_TEMPLATES, WORKFLOW_AD, workflowFrame, nextWorkflowPhase } from "../src/lib/homepage-concept/workflow.ts";

test("workflow preserves selection, editing, review and approval order", () => {
  assert.deepEqual(WORKFLOW_PHASES.map(x=>x.step), [0,0,1,1,1,2,2,2,2]);
  assert.deepEqual(WORKFLOW_STEP_STARTS, [0,2,5]);
  for (let phase=0;phase<9;phase++) {
    const frame=workflowFrame(phase);
    assert.equal(frame.template, phase===0?0:1);
    assert.equal(frame.postEdited, phase>=3);
    assert.equal(frame.titleEdited, phase>=4);
    assert.equal(frame.filled, phase>=6);
    assert.equal(frame.pressing, phase===7);
    assert.equal(frame.approved, phase===8);
    assert.equal(nextWorkflowPhase(phase), (phase+1)%9);
  }
  assert.ok(WORKFLOW_PHASES[3].duration>=2000);
  assert.ok(WORKFLOW_PHASES[4].duration>=2000);
  assert.ok(WORKFLOW_PHASES[8].duration>=2000);
});
test("same realistic listing fixture persists from selection to approval", () => {
  assert.equal(WORKFLOW_TEMPLATES[1].id,"listing");
  assert.equal(new Set(Array.from({length:8},(_,i)=>workflowFrame(i+1).template)).size,1);
  assert.equal(WORKFLOW_AD.editedTitle,"18 Olive Street");
  assert.ok(WORKFLOW_AD.editedTitle.length<24);
  assert.ok(WORKFLOW_TEMPLATES.every(x=>x.image.startsWith("/home/")));
});
test("one studio, ad and template rail stay mounted through all phases", async()=>{
  const source=await readFile(new URL("../src/components/homepage-concept/workflow-showcase.tsx",import.meta.url),"utf8");
  assert.equal((source.match(/<StudioAd /g)||[]).length,1);
  assert.equal((source.match(/<aside className="wf-library"/g)||[]).length,1);
  assert.equal((source.match(/<StudioInspector /g)||[]).length,1);
  assert.doesNotMatch(source,/AnimatePresence|LayoutGroup|layoutId|StoryCursor|MousePointer|YOUR SUBIACO HOME|fetch\(|localStorage|sessionStorage|\u2014/);
  assert.match(source,/IntersectionObserver/);
  assert.match(source,/visibilitychange/);
  assert.match(source,/preference.addEventListener\("change", syncMotion\)/);
  assert.match(source,/if \(reduced \|\| !visible \|\| !pageVisible\) return/);
  assert.match(source,/WORKFLOW_PHASES.length - 1/);
});


test("workflow displays the exact owner-selected heading and subheading", async () => {
  const source = await readFile(new URL("../src/components/homepage-concept/workflow-showcase.tsx", import.meta.url), "utf8");
  assert.ok(source.includes('<h2><span>More leads.</span>{" "}<span>Less ad management.</span></h2>'));
  assert.ok(source.includes("<p>Customise a proven template and publish your lead-generating ad, all in one place.</p>"));
  assert.ok(!source.includes("<h2>Create real estate ads"));
});

test("owner-selected heading stays on two responsive lines", async () => {
  const css = await readFile(new URL("../src/components/homepage-concept/workflow-showcase.css", import.meta.url), "utf8");
  assert.ok(css.includes("container-type: inline-size"));
  assert.ok(css.includes("font-size: min(58px,9.8cqi)"));
  assert.ok(css.includes(".hc-process-copy h2 > span { display: block; white-space: nowrap; }"));
});
