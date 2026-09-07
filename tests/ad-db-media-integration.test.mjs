import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {dirname,join} from 'node:path';
const source=readFileSync('hermes/tools/research-runtime/bin/supabase-supervisor.mjs','utf8').replace(/\r\n/g,'\n');
function load(name,next,context){const start=source.indexOf('async function '+name+'('),end=source.indexOf('\nasync function '+next+'(',start)>=0?source.indexOf('\nasync function '+next+'(',start):source.indexOf('\nfunction '+next+'(',start);assert.ok(start>=0&&end>start);const code=source.slice(start,end).replaceAll('import.meta.url',JSON.stringify('file:///srv/test/supabase-supervisor.mjs'));return vm.runInNewContext(code+';'+name,{...context});}
const creative='11111111-1111-4111-8111-111111111111',ad='22222222-2222-4222-8222-222222222222',asset='33333333-3333-4333-8333-333333333333';
test('ScrapingBee Auto-Mode includes a bounded Meta render wait',()=>{
  assert.match(source,/HERMES_SCRAPINGBEE_WAIT_MS[^\n]+5_000/);
  assert.match(source,/wait: String\(scrapingBeeWaitMs\)/);
  assert.match(source,/Math\.min\([^\n]+35_000\)/);
});
test('primary ScrapingBee failure fails closed without legacy browser fallback',async()=>{
  let fallbackCalls=0;
  const fn=load('runMetaPageCapture','failedCaptureOutcome',{
    configuredMetaFallbackSourceProvider:()=> 'hermes_meta_page_capture',
    scrapingBeeEnabled:true,scrapingBeeOrder:'primary',metaOfficialApiEnabled:false,
    runScrapingBeePageCapture:async()=>({status:'FAILED',errorMessage:'provider failed',metadata:{charge_known:true}}),
    runFallbackMetaPageCapture:async()=>{fallbackCalls+=1;throw Error('legacy fallback must not run')},
    log:()=>{},META_SCRAPINGBEE_SOURCE_PROVIDER:'scrapingbee_meta_ad_library',
    captureModeForSourceProvider:()=> 'scrapingbee_auto',
  });
  const result=await fn({advertiserPageId:ad,metaPageId:'42'});
  assert.equal(result.outcome.status,'FAILED');
  assert.equal(result.sourceProvider,'scrapingbee_meta_ad_library');
  assert.equal(fallbackCalls,0);
});
test('media collector uses verified archive without legacy overwrite or AI follow-up',async()=>{
  const captures=[],patches=[];
  const fn=load('handleMediaCollector','loadCreativeForMediaCapture',{rest:async()=>[{id:asset,observed_ad_id:ad}],captureMediaAsset:async a=>captures.push(a.id),patchMediaAsset:async(...a)=>patches.push(a),enqueueFollowUp:()=>{throw Error('AI must not be queued')},refreshCreativeStoredMedia:()=>{throw Error('legacy public URL path must not run')}});
  const result=await fn({payload:{adCreativeId:creative,observedAdId:ad}});
  assert.equal(result.result.captured,1);assert.equal(result.result.model_calls,0);assert.deepEqual(captures,[asset]);assert.equal(patches.length,0);
});
test('media collector captures a large carousel in one canonical job',async()=>{
  const assets=Array.from({length:37},(_,index)=>({id:`asset-${index}`,observed_ad_id:ad})),captures=[],queries=[];
  const fn=load('handleMediaCollector','loadCreativeForMediaCapture',{
    rest:async(_schema,query)=>{queries.push(query);return assets;},
    captureMediaAsset:async asset=>captures.push(asset.id),
    patchMediaAsset:async()=>{throw Error('successful assets must not be patched as failed')},
  });
  const result=await fn({payload:{adCreativeId:creative,observedAdId:ad}});
  assert.equal(result.result.captured,37);
  assert.equal(result.result.failed,0);
  assert.equal(captures.length,37);
  assert.ok(queries[0].includes('&limit=250'));
});
test('media collector rejects invalid scope without querying or spawning',async()=>{
 const fn=load('handleMediaCollector','loadCreativeForMediaCapture',{rest:()=>{throw Error('must not query')}});
 assert.equal((await fn({payload:{adCreativeId:'bad',observedAdId:ad}})).status,'blocked');
});
test('capture actually starts archive CLI and verifies ad-scoped archive result',async()=>{
 const hash='a'.repeat(64),calls=[],queries=[];
 const context={env:{},join,dirname,URL,process:{execPath:'/usr/bin/node'},encode:encodeURIComponent,
 spawn:(...args)=>{calls.push(args);const child=new EventEmitter();queueMicrotask(()=>child.emit('close',0));return child;},
 rest:async(_schema,q)=>{queries.push(q);return[{id:asset,content_hash:hash,object_key:'sha256/'+hash,byte_size:32}]}};
 const fn=load('captureMediaAsset','ensureRawEvidenceBucket',context);
 await fn({id:asset,observed_ad_id:ad});assert.equal(calls.length,1);assert.equal(calls[0][1][1],'--asset-id');assert.equal(calls[0][1][2],asset);assert.match(queries[0],new RegExp('observed_ad_id=eq.'+ad));
 context.rest=async()=>[{content_hash:hash,object_key:'old-cdn-path',byte_size:32}];
 await assert.rejects(()=>load('captureMediaAsset','ensureRawEvidenceBucket',context)({id:asset,observed_ad_id:ad}),/verified object/);
});
test('upsert preserves a verified captured asset without resetting to pending',async()=>{
 let patches=0;
 const fn=load('upsertMediaAssets','isMediaAssetUniqueConflict',{rest:async()=>[{id:asset,capture_status:'captured',archive_object_id:'object',archive_verified_at:'2026-09-05'}],encode:encodeURIComponent,patchMediaAsset:async()=>{patches++}});
 const count=await fn({creativeId:creative,observedAdId:ad,mediaSources:[{source_url:'https://cdn.example/image',kind:'image'}]});assert.equal(count,1);assert.equal(patches,0);
});

test('post-ingest only queues media by default, not classifier work',async()=>{
 const queued=[];
 const fn=load('enqueuePostIngestJobs','extractLinks',{env:{},enqueueFollowUp:async x=>queued.push(x.job_type)});
 await fn({media_sources:1,ad_creative_id:creative,observed_ad_id:ad,creative_hash:'hash'},'page','run',{});
 assert.deepEqual(queued,['blockwise-media-collector']);
});
test('collector requires the database page and Meta page identity to agree',async()=>{
 const queries=[];
 const fn=load('handleAdCollector','handleMediaCollector',{uuidPattern:/^[0-9a-f-]{36}$/i,encode:encodeURIComponent,rest:async(_s,q)=>{queries.push(q);return[];}});
 const result=await fn({payload:{advertiserPageId:ad,metaPageId:'42'}});
 assert.equal(result.status,'blocked');assert.equal(result.result.collection_started,false);
 assert.ok(queries[0].includes('&id=eq.'+ad+'&page_id=eq.42&'));assert.ok(!queries[0].includes('or='));
 const invalid=await fn({payload:{advertiserPageId:ad,metaPageId:'slug-not-id'}});
 assert.equal(invalid.blocked_reason,'collector_invalid_page_identity');assert.equal(queries.length,1);
});
