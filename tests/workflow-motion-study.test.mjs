import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { studyFrame, studyTransition, studyAdMotion, studyEditLayout } from "../src/components/motion-study/workflow-motion-study-geometry.ts";
const source = await readFile(new URL("../src/components/motion-study/workflow-motion-study.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../src/components/motion-study/workflow-motion-study.module.css", import.meta.url), "utf8");

test("one clock owns all transitions; selectors interrupt without resetting progress", () => {
  assert.match(source, /const progress = useMotionValue\(1\)/);
  assert.match(source, /animate\(progress, 1/);
  assert.match(source, /controls.stop\(\)/);
  assert.ok(source.indexOf("setManual(true);", source.indexOf("const selectStep")) < source.indexOf("if (next === step) return"));
  assert.doesNotMatch(source, /AnimatePresence|headlineChars|headlineIndexRef|requestAnimationFrame/);
});

test("complete choreography endpoints", () => {
  assert.deepEqual(studyFrame(0), { ad:0,gallery:1,panel:0,edit:1,review:0,original:1,updated:0,approved:0 });
  assert.equal(studyFrame(1).panel,1);
  assert.equal(studyFrame(1).edit,1);
  assert.equal(studyFrame(2).review,1);
  assert.equal(studyFrame(3).approved,1);
});

test("movement and panel reveal overlap, with no empty handover", () => {
  const moving = studyFrame(.3);
  assert.ok(moving.ad > 0 && moving.ad < 1);
  assert.ok(moving.panel > 0 && moving.panel < 1);
  assert.ok(studyFrame(.6).panel === 1);
  for(let p=1;p<=2;p+=.02) {
    const f=studyFrame(p);
    assert.equal(f.panel,1);
    assert.ok(Math.abs(f.edit+f.review-1)<1e-10);
    assert.equal(f.ad,1);
  }
});

test("reverse travel keeps alternatives hidden until the selected card approaches Choose", () => {
  assert.equal(studyFrame(.5).gallery,0);
  assert.ok(studyFrame(.15).gallery > 0);
  for(let p=-1;p<4;p+=.013) {
    const f=studyFrame(p);
    assert.ok(Object.values(f).every(n=>n>=0 && n<=1));
    assert.ok(Math.abs(f.original+f.updated-1)<1e-10);
  }
});

test("all intermediate ad positions remain inside desktop and phone stages", () => {
  for(const [stageWidth,stageHeight,adWidth,adHeight,narrow] of [[278,650,224,180,true],[348,650,224,180,true],[560,560,260,502,false],[695,560,260,502,false],[1040,560,260,502,false]]) {
    const input={stageWidth,stageHeight,adWidth,adHeight,narrow};
    const a=studyAdMotion({...input,customise:false});
    const b=studyAdMotion({...input,customise:true});
    const panel=studyEditLayout(input);
    assert.ok(panel.panelLeft+panel.panelWidth<=stageWidth);
    for(let p=0;p<=1;p+=.025) {
      const x=a.x+(b.x-a.x)*p,y=a.y+(b.y-a.y)*p,s=1+(b.scale-1)*p;
      assert.ok(x>=0 && y>=0);
      assert.ok(x+adWidth*s<=stageWidth+.01 && y+adHeight*s<=stageHeight+.01);
    }
  }
});

test("editor and review remain mounted in one fixed surface with hidden layers inert", () => {
  assert.match(source, /className=\{styles.bwStudyPanelSurface\}/);
  assert.equal((source.match(/<motion.section className=\{styles.bwStudyEditPanel\}/g)||[]).length,2);
  assert.match(source, /inert=\{step !== 1\}/);
  assert.match(source, /inert=\{step !== 2\}/);
  assert.match(styles,/height: 392px/);
  assert.match(styles,/height: 400px/);
  assert.match(styles,/grid-area: 1 \/ 1/);
});

test("static text, accessible selectors, finite autoplay and reduced motion", () => {
  assert.equal((source.match(/<textarea/g)||[]).length,3);
  assert.match(source,/value=\{SELECTED_AD.adTitle\}/);
  assert.match(source,/aria-pressed=\{step === index\}/);
  assert.match(source,/settledScene !== scene/);
  assert.match(source,/entry.intersectionRatio >= 0.6/);
  assert.match(source,/document.visibilityState/);
  assert.match(source,/if \(reduced\) \{ setManual\(true\); setScene\(3\); \}/);
  assert.match(source,/scene === 3/);
  assert.match(source,/frame.set\(to\)/);
  assert.match(styles,/prefers-reduced-motion/);
  assert.match(source,/Free trial · No card required · Cancel anytime/);
});

test("direct Choose to Review does not reveal the editor", () => {
  for (let t=.01;t<1;t+=.02) {
    const f=studyTransition(studyFrame(0),studyFrame(2),t);
    assert.equal(f.edit,0);
    assert.equal(f.review,1);
  }
});
test("interruption resumes at the captured visual frame", () => {
  const interrupted=studyTransition(studyFrame(0),studyFrame(1),.43);
  assert.deepEqual(studyTransition(interrupted,studyFrame(0),0),interrupted);
  assert.equal(studyTransition(studyFrame(2),studyFrame(0),.4).gallery,0);
  assert.equal(studyTransition(studyFrame(2),studyFrame(0),.2).edit,0);
});
