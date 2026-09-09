import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {dirname,join} from 'node:path';
const source=readFileSync('hermes/tools/research-runtime/bin/supabase-supervisor.mjs','utf8').replace(/\r\n/g,'\n');
function load(name,next,context){const start=source.indexOf('async function '+name+'('),end=source.indexOf('\nasync function '+next+'(',start)>=0?source.indexOf('\nasync function '+next+'(',start):source.indexOf('\nfunction '+next+'(',start);assert.ok(start>=0&&end>start);const code=source.slice(start,end).replaceAll('import.meta.url',JSON.stringify('file:///srv/test/supabase-supervisor.mjs'));return vm.runInNewContext(code+';'+name,{...context});}
function loadWithDependency(name, dependency, next, context){const start=source.indexOf('async function '+dependency+'('),end=source.indexOf('\nasync function '+next+'(',start);assert.ok(start>=0&&end>start);const code=source.slice(start,end).replaceAll('import.meta.url',JSON.stringify('file:///srv/test/supabase-supervisor.mjs'));return vm.runInNewContext(code+';'+name,{...context});}
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
  const fn=load('handleMediaCollector','loadCreativeForMediaCapture',{rest:async()=>[{id:asset,observed_ad_id:ad}],captureMediaAsset:async a=>captures.push(a.id),patchMediaAsset:async(...a)=>patches.push(a),enqueueFollowUp:()=>{throw Error('AI must not be queued')},refreshCreativeStoredMedia:()=>{throw Error('legacy public URL path must not run')},refreshClassifiedCreativeDisplay:async()=>{}});
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

test('post-ingest queues independent media and deterministic classifier children',async()=>{
 const queued=[];
 const fn=load('enqueuePostIngestJobs','extractLinks',{env:{},CLASSIFIER_VERSION:'test-version',enqueueFollowUp:async x=>queued.push(x)});
 await fn({media_sources:1,ad_creative_id:creative,observed_ad_id:ad,creative_hash:'hash'},'page','run',{});
 assert.deepEqual(queued.map((x)=>x.job_type),['blockwise-media-collector','blockwise-ad-classifier']);assert.equal(queued[1].dedupe_key,'ad-radar:classifier:'+creative+':hash:test-version:saved');assert.equal(queued[1].payload.classifierMode,'deterministic');assert.equal(queued[1].payload.ad_db_child,true);
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


test('deterministic classifier persists from saved creative without model or media path', async () => {
  const decisions = [], patches = [], queries = [];
  const fn = load('handleAdClassifier', 'captureMediaAsset', {
    rest: async (_schema, path, options) => {
      queries.push(path);
      if (path.startsWith('ad_creatives?select=')) return [{ id: creative, observed_ad_id: ad, creative_hash: 'hash', format: 'text', headline: 'New listing', body: 'A home open this Saturday in Perth', cta: 'Learn more', landing_url: 'https://example.test' }];
      if (path.startsWith('media_assets?')) return [];
      if (path === 'agent_decisions') { decisions.push(JSON.parse(options.body)); return [{ id: 'decision-1' }]; }
      if (path.startsWith('ad_creatives?id=')) { patches.push(JSON.parse(options.body)); return [{ id: creative }]; }
      throw new Error('unexpected REST path ' + path);
    },
    classifyCreativeFromSavedEvidence: () => ({
      classification: { is_real_estate_ad: true, confidence: 0.8, ad_type: 'listing', primary_intent: 'listing', rationale: 'saved', rejection_reason: null },
      model: 'deterministic-saved-evidence',
      evidenceSource: 'saved_creative',
    }),
    classifyCreativeWithModels: () => { throw new Error('model path must not run'); },
    shouldWaitForMediaClassification: () => { throw new Error('media wait must not run for deterministic child'); },
    hasUnresolvedDynamicPlaceholder: () => false,
    hasUsableCapturedMedia: () => false,
    shouldDisplayClassifiedCreative: () => true,
    CLASSIFIER_VERSION: 'test-version',
    classifierCreativeHash: () => 'hash',
    narrowAdDbMode: true,
    env: {},
    now: () => '2026-09-08T00:00:00.000Z',
    workerId: 'test-worker',
    json: JSON.stringify,
    storagePublicUrlForPath: () => null,
    encode: encodeURIComponent,
    refreshClassifiedCreativeDisplay: async () => {},
  });
  const result = await fn({ payload: { adCreativeId: creative, observedAdId: ad, creative_hash: 'hash', classifierMode: 'deterministic', ad_db_child: true } });
  assert.equal(result.status, 'complete');
  assert.equal(decisions.length, 1);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].classification_status, 'classified');
  assert.match(queries.find((path) => path.startsWith('media_assets?')), /archive_object_id=not.is.null/);
  assert.match(queries.find((path) => path.startsWith('media_assets?')), /archive_verified_at=not.is.null/);
});

test('classification backfill only queues WA-owned weak creatives', async () => {
  const waAgent = '11111111-1111-4111-8111-111111111111';
  const vicAgent = '22222222-2222-4222-8222-222222222222';
  const waPage = '33333333-3333-4333-8333-333333333333';
  const vicPage = '44444444-4444-4444-8444-444444444444';
  const waObserved = '55555555-5555-4555-8555-555555555555';
  const vicObserved = '66666666-6666-4666-8666-666666666666';
  const candidates = [
    { id: 'wa-weak', observed_ad_id: waObserved, creative_hash: 'wa-hash', classification_status: 'unclassified', classification: {}, ad_type: 'other', primary_intent: 'other' },
    { id: 'vic-weak', observed_ad_id: vicObserved, creative_hash: 'vic-hash', classification_status: 'unclassified', classification: {}, ad_type: 'other', primary_intent: 'other' },
    { id: 'wa-strong', observed_ad_id: waObserved, creative_hash: 'strong-hash', classification_status: 'classified', classification: { classifier_version: 'ad-library-classifier-v2', ad_type: 'listing', primary_intent: 'listing' }, ad_type: 'listing', primary_intent: 'listing' },
  ];
  const fn = loadWithDependency('loadClassificationBackfillCandidates', 'loadWaOwnedAdCreativeIds', 'claimJobs', {
    rest: async (_schema, path) => {
      if (path.startsWith('ad_creatives?') && !path.startsWith('ad_creatives?id=')) return candidates;
      if (path.startsWith('observed_ads?')) return [{ id: waObserved, advertiser_page_id: waPage }, { id: vicObserved, advertiser_page_id: vicPage }];
      if (path.startsWith('advertiser_pages?')) return [{ id: waPage, agent_id: waAgent, agency_id: null }, { id: vicPage, agent_id: vicAgent, agency_id: null }];
      if (path.startsWith('agents?')) return [{ id: waAgent, state: 'WA' }, { id: vicAgent, state: 'VIC' }];
      if (path.startsWith('agencies?')) return [];
      throw new Error('unexpected backfill path ' + path);
    },
    uuidPattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu,
    encode: encodeURIComponent,
    CLASSIFIER_VERSION: 'test-version',
    classificationBackfillBatchSize: 80,
    classificationBackfillWeakBatchSize: 10,
    shouldReclassifyCreative: (row) => row.id === 'wa-weak' || row.id === 'vic-weak',
  });
  assert.deepEqual(Array.from(await fn(), (row) => row.id), ['wa-weak']);
});

test('media completion refreshes a classified hidden creative to displayable', async () => {
  const patches = [];
  const fn = load('refreshClassifiedCreativeDisplay', 'captureMediaAsset', {
    encode: encodeURIComponent,
    json: JSON.stringify,
    shouldDisplayClassifiedCreative: () => true,
    rest: async (_schema, path, options) => {
      if (path.startsWith('ad_creatives?') && !path.startsWith('ad_creatives?id=')) return [{
        id: creative, classification_status: 'classified', display_state: 'hidden',
        classification: { ad_type: 'listing' },
      }];
      if (path.startsWith('media_assets?')) return [{ id: asset, capture_status: 'captured', archive_object_id: 'sha256/x', archive_verified_at: 'now' }];
      if (path.startsWith('ad_creatives?id=')) { patches.push(JSON.parse(options.body)); return []; }
      throw new Error('unexpected path ' + path);
    },
  });
  await fn(creative);
  assert.deepEqual(patches, [{ display_state: 'displayable' }]);
});

test('saved unknown classifications do not starve later backfill pages', async () => {
  const version = 'test-version';
  const saved = {id: 'saved-unknown', observed_ad_id: ad, creative_hash:'old',
    classification_status:'classified', classification:{classifier_version:version+':saved',creative_hash:'old'},
    ad_type:'other',primary_intent:'other'};
  const later = {id:'later',observed_ad_id:ad,creative_hash:'new',classification_status:'unclassified',classification:{}};
  const offsets = [];
  const fn = loadWithDependency('loadClassificationBackfillCandidates', 'loadWaOwnedAdCreativeIds', 'claimJobs', {
    rest: async (_schema, path) => {
      if (path.startsWith('ad_creatives?')) {
        const offset=Number(new URLSearchParams(path.split('?')[1]).get('offset'));
        offsets.push(offset);
        return offset===0?[saved]:offset===1?[later]:[];
      }
      if (path.startsWith('observed_ads?')) return [{id:ad,advertiser_page_id:asset}];
      if (path.startsWith('advertiser_pages?')) return [{id:asset,agent_id:creative}];
      if (path.startsWith('agents?')) return [{id:creative,state:'WA'}];
      if (path.startsWith('agencies?')) return [];
      throw new Error(path);
    },
    uuidPattern:/^[0-9a-f-]{36}$/i,encode:encodeURIComponent,CLASSIFIER_VERSION:version,
    classificationBackfillBatchSize:1,classificationBackfillWeakBatchSize:1,
    shouldReclassifyCreative:()=>true,
  });
  assert.deepEqual(Array.from(await fn(), row=>row.id), ['later']);
  assert.deepEqual(offsets,[0,1]);
});
