import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import test from 'node:test';
import { CREATIVE_EDIT_EXAMPLES, CREATIVE_EDIT_CYCLE_MS, creativeEditFrame } from '../src/lib/homepage-concept/creative-edit.ts';

test('every objective has a stable repeatable selection, typing and rest timeline', () => {
  assert.deepEqual(CREATIVE_EDIT_EXAMPLES.map(x=>x.id), ['appraisal','consult','buyers','report']);
  for (const example of CREATIVE_EDIT_EXAMPLES) {
    assert.equal(creativeEditFrame(0,example).text, example.initialOverlay);
    assert.equal(creativeEditFrame(1200,example).phase, 'select');
    assert.deepEqual(creativeEditFrame(2000,example), {phase:'type', text:example.editedOverlay.slice(0,5)});
    assert.equal(creativeEditFrame(3300,example).text,example.editedOverlay);
    assert.equal(creativeEditFrame(6000,example).phase,'done');
    assert.equal(creativeEditFrame(6800,example).phase,'reset');
    assert.deepEqual(creativeEditFrame(2000+100*CREATIVE_EDIT_CYCLE_MS,example),creativeEditFrame(2000,example));
  }
});

test('creative fixtures use existing non-hero images and no explainer copy',async () => {
  const hero=await readFile(new URL('../src/components/homepage-concept/homepage-concept.tsx',import.meta.url),'utf8');
  for (const example of CREATIVE_EDIT_EXAMPLES) {
    await access(new URL('../public'+example.image,import.meta.url));
    assert.ok(!hero.includes(example.image));
    assert.doesNotMatch(JSON.stringify(example), /\u2014/);
  }
  const component=await readFile(new URL('../src/components/homepage-concept/creative-edit-preview.tsx',import.meta.url),'utf8');
  assert.match(component,/prefers-reduced-motion/);
  assert.match(component,/visibilitychange/);
  assert.match(component,/IntersectionObserver/);
  assert.doesNotMatch(component,/fetch\(|requestMockTrial|localStorage|Replay|Pause/);
});
