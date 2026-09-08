import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('template gallery presents existing creatives and accessible category filters', async () => {
 const source = await readFile(new URL('../src/components/homepage-concept/homepage-concept.tsx', import.meta.url), 'utf8');
 const gallery = source.slice(source.indexOf('<section className="hc-examples"'), source.indexOf('<section className="hc-control"'));
 assert.match(gallery, /Find your next ad\./);
 assert.match(gallery, /All templates/);
 assert.match(gallery, /aria-pressed=\{exampleFilter === example.id\}/);
 assert.match(source, /AD_EXAMPLES.filter\(\(example\) => exampleFilter === "all" \|\| example.id === exampleFilter\)/);
 assert.match(gallery, /visibleExamples.map/);
 assert.match(gallery, /src=\{withBasePath\(example.image\)\}/);
 assert.match(gallery, /role="status"/);
 assert.match(gallery, /Use this template/);
 assert.doesNotMatch(gallery, /<dl>|About this ad|Start appraisal conversations/);
});
