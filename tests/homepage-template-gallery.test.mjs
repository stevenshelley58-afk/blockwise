import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('removed gallery leaves no section or navigation link', async () => {
 const source = await readFile(new URL('../src/components/homepage-concept/homepage-concept.tsx', import.meta.url), 'utf8');
 assert.doesNotMatch(source, /Find your next ad|id="examples"|href="#examples"|exampleFilter|AD_EXAMPLES/);
 assert.match(source, /<ResultsReporting \/>/);
 assert.match(source, /<WorkflowMotionStudy \/>/);
 assert.doesNotMatch(source, /CampaignControls|id="control"|href="#control"/);
});
