import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('homepage includes the three current pricing plans directly before FAQ', async () => {
 const page=await readFile(new URL('../src/components/homepage-concept/homepage-concept.tsx',import.meta.url),'utf8');
 assert.match(page, /<HomepagePricing \/>\s*<section className="hc-faq"/);
 const data=await readFile(new URL('../src/lib/homepage-concept/pricing.ts',import.meta.url),'utf8');
 for(const value of ['A$0','A$249','from A$1,500','until cancelled','GST included where required.','Up to four live campaigns']) assert.ok(data.includes(value));
 assert.equal((data.match(/featured:/g)||[]).length,3);
 const component=await readFile(new URL('../src/components/homepage-concept/homepage-pricing.tsx',import.meta.url),'utf8');
 assert.match(component,/HOMEPAGE_PLANS.map/);
 assert.match(component,/plan.features.map/);
 assert.match(component,/plan.terms/);
 assert.doesNotMatch(component+data,/\u2014/);
});
