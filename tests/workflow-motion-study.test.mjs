import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { studyTypingSchedule, studyText, studyFrame, studyTransition, studyAdMotion, studyEditLayout } from "../src/components/motion-study/workflow-motion-study-geometry.ts";
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
  assert.deepEqual(studyFrame(0), { hop:0,browse:1,shell:1,shellAlpha:1,ad:0,gallery:1,panel:0,edit:1,review:0,original:1,updated:0,approved:0 });
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

test("completion-gated writing, accessible selectors, finite autoplay and reduced motion", () => {
  assert.equal((source.match(/<StudyField clock=/g)||[]).length,2);
  assert.match(source,/value=\{value\}/);
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

 test("text layers hand over without double exposure", () => {
  for (const [a,b] of [[0,1],[1,0],[1,2],[2,1]]) {
    for(let t=0;t<=1;t+=.01) {
      const f=studyTransition(studyFrame(a),studyFrame(b),t);
      assert.ok(f.original*f.updated<1e-10);
      if(a>=1 && b>=1) assert.ok(f.edit*f.review<1e-10);
    }
  }
});

test("browse advances across three distinct positions before selection", () => {
  assert.equal(studyFrame(-2).browse,0);
  assert.equal(studyFrame(-1).browse,.5);
  assert.equal(studyFrame(0).browse,1);
  assert.match(source,/ad=\{ad\}/);
  assert.match(source,/withBasePath\(ad.image\)/);
});
test("right panel shrinks out then grows before text while ad remains unchanged", () => {
 const a=studyFrame(1), b=studyFrame(2);
 const out=studyTransition(a,b,.2), hidden=studyTransition(a,b,.38), growing=studyTransition(a,b,.6), text=studyTransition(a,b,.9);
 assert.ok(out.shell<1 && out.shellAlpha<1);
 assert.equal(hidden.shellAlpha,0);
 assert.ok(growing.shell>hidden.shell && growing.shell<1);
 assert.equal(growing.review,0);
 assert.equal(text.shell,1); assert.ok(text.review>0);
 for(let t=0;t<=1;t+=.01) { const f=studyTransition(a,b,t); assert.equal(f.ad,1); assert.equal(f.updated,1); assert.equal(f.browse,1); }
});

test("initial selected card waits for geometry and returning to Choose preserves it", () => {
 assert.match(source,/visibility: "hidden"/);
 assert.match(source,/setScene\(reduced && next === 2 \? 3 : next\)/);
});

test("fields enter empty then fill at the same character boundary as the ad", () => {
  const text="Your home could be worth more";
  assert.equal(studyText(0,text,.08,.32),"");
  assert.equal(studyText(.08,text,.08,.32),"");
  assert.equal(studyText(.2,text,.08,.32),text.slice(0,14));
  assert.equal(studyText(.32,text,.08,.32),text);
  assert.equal(studyText(.5,text,.08,.32),text);
  assert.equal(studyText(0,text,.08,.32,"Before"),"Before");
  assert.match(source,/settledScene !== scene \|\| \(scene !== 1 && scene !== 2\)/);
  assert.match(source,/!contentDone/);
  assert.match(source,/if \(scene === 1\) draft.set\(0\)/);
  assert.match(source,/contentPlayback.current\?\.pause/);
});

test("typing reserves enough ad copy height for the original three lines", () => {
  assert.match(styles, /bwStudyAdCopy \{ height: 64px; min-height: 64px/);
  assert.match(styles, /bwStudyLink \{ height: 58px/);
});


test("both screens type at one character speed with short consistent field gaps", () => {
  const words=["Homeowners and potential sellers","$20 per day","14 days"];
  const schedule=studyTypingSchedule(words,38,120);
  schedule.ranges.forEach((range,i) => {
    assert.ok(Math.abs((range.end-range.start)*schedule.durationMs-words[i].length*38)<1e-8);
    assert.equal(studyText(range.start,words[i],range.start,range.end),"");
    assert.equal(studyText(range.end,words[i],range.start,range.end),words[i]);
    assert.equal(studyText(range.start+38*1.1/schedule.durationMs,words[i],range.start,range.end),words[i][0]);
  });
  assert.equal((source.match(/<StudyReviewValue clock=/g)||[]).length,3);
  assert.doesNotMatch(source,/audienceOpacity|budgetOpacity|durationOpacity/);
  assert.match(source,/panelSwap \? "linear"/);
});


test("two editor fields shorten writing and approval drives the ad hop and Live badge", () => {
  assert.doesNotMatch(source,/study-link-title|EDIT_WRITING.ranges\[2\]/);
  assert.match(source,/const EDIT_TEXTS = \[SELECTED_AD.adTitle, AD_TEXT\]/);
  assert.match(source,/live=\{approvedOpacity\}/);
  assert.match(source,/f.hop \* 10/);
  assert.equal(studyFrame(3).hop,0);
  assert.equal(studyTransition(studyFrame(2),studyFrame(3),0).hop,0);
  const mid=studyTransition(studyFrame(2),studyFrame(3),.5);
  assert.equal(mid.hop,1);
  assert.equal(mid.approved,.5);
  assert.ok(studyTransition(studyFrame(2),studyFrame(3),1).hop<1e-10);
  assert.equal(studyTransition(studyFrame(3),studyFrame(1),.5).hop,0);
  assert.equal(studyTransition(mid,studyFrame(1),0).hop,mid.hop);
});

test("editor fields stay compact and the redundant bottom bar is absent", () => {
  assert.doesNotMatch(source, /bwStudyHint|hint:/);
  assert.doesNotMatch(styles, /bwStudyHint|label:last-child textarea/);
  assert.match(source, /label="Ad text"[^\n]+rows=\{3\}/);
});
