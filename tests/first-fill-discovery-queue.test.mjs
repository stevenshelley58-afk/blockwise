import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDiscoveryJobs} from '../scripts/research/first-fill-discovery-queue.mjs';
test('first fill includes agents and agencies, excludes checked matches, blocks absent evidence',()=>{
 const roster=[{kind:'agent',id:'a',identity_status:'unchecked'},{kind:'agency',id:'b',identity_status:'attempted'},{kind:'agent',id:'c',identity_status:'page_found'},{kind:'agent',id:'d',identity_status:'unchecked'}];
 const subjects=roster.map(x=>({...x,decision_id:'proof',source_ids:x.id==='d'?[]:['source'],metadata:{}}));
 const p=makeDiscoveryJobs(roster,subjects);assert.equal(p.jobs.length,2);assert.equal(p.blocked.length,1);assert.equal(p.jobs[1].payload.subjectKind,'agency');assert.ok(p.jobs.every(x=>x.payload.scanMode==='initial_fill'));assert.equal(p.blocked[0].reason,'missing_verified_census_evidence');
});

import {readFileSync} from 'node:fs';
test('discovery is narrow and unverified zero never advances first fill',()=>{
 const source=readFileSync(new URL('../hermes/tools/research-runtime/bin/supabase-supervisor.mjs',import.meta.url),'utf8');
 assert.match(source,/First-fill discovery forbids paid browser\/proxy configuration/);
 assert.match(source,/original_subject_checked: true/);
 const block=source.slice(source.indexOf('if (unverifiedZero && outcome.itemCount === 0)'),source.indexOf('const ingested = []',source.indexOf('if (unverifiedZero && outcome.itemCount === 0)')));
 assert.match(block,/coverage_complete: false/);assert.doesNotMatch(block,/markAdvertiserPageScanSucceeded/);
});
