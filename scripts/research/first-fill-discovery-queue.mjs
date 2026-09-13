#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function makeDiscoveryJobs(roster, subjects) {
  const targets = new Set(roster.filter(x => ['unchecked','attempted','failed'].includes(x.identity_status)).map(x => x.kind+':'+x.id));
  const blocked = [], jobs = [];
  for (const s of subjects) {
    if (!targets.has(s.kind+':'+s.id)) continue;
    if (!s.decision_id || !s.source_ids?.length) { blocked.push({kind:s.kind,id:s.id,reason:'missing_verified_census_evidence'}); continue; }
    const e=s.metadata?.cold_email_enrichment?.v1 || {};
    jobs.push({queue_name:'research', job_type:'blockwise-page-resolver', dedupe_key:'first-fill-discovery-v1:'+s.kind+':'+s.id, priority:e.social_links?.facebook ? 8 : 12, status:'pending',max_attempts:2,payload:{subjectKind:s.kind,subjectId:s.id,censusDecisionId:s.decision_id,sourceDocumentIds:s.source_ids,scanMode:'initial_fill',facebookUrl:e.social_links?.facebook || null,profileUrl:e.profile_url || s.profile_url || null,websiteUrl:e.website || s.website_url || null,location_search_allowed:false}});
  }
  return {jobs,blocked};
}
function sql(q) { return execFileSync('docker',['exec','-i','blockwise-research-db','psql','-U','postgres','-d','blockwise_research','-X','-v','ON_ERROR_STOP=1','-At'],{input:q,encoding:'utf8',maxBuffer:64*1024*1024}).trim(); }
function main(){
 const reportArg=process.argv.find(x=>x.startsWith('--report='));
 if(!reportArg) throw new Error('--report=<fresh accountability report> required');
 const roster=JSON.parse(readFileSync(reportArg.slice(9),'utf8')).roster;
 const rows=JSON.parse(sql(`with subjects as (select 'agent'::text kind,id::text,metadata,website_url,null::text profile_url from research.agents where upper(state)='WA' union all select 'agency',id::text,metadata,website_url,null::text from research.agencies where upper(state)='WA') select coalesce(json_agg(x),'[]') from (select s.*,d.id decision_id,d.source_document_ids source_ids from subjects s left join lateral (select d.id,d.source_document_ids from research.agent_decisions d where d.subject_type=s.kind and d.subject_id=s.id and d.decision_type='real_estate_verification' and d.decision->>'verified'='true' and cardinality(d.source_document_ids)>0 and not exists(select 1 from unnest(d.source_document_ids) sid where not exists(select 1 from research.source_documents sd where sd.id=sid)) order by d.decided_at desc limit 1) d on true) x;`));
 const plan=makeDiscoveryJobs(roster,rows);
 if(process.argv.includes('--apply')) {
   // Serialize dispatch, preserve all history, and never reset failed attempts.
   const body=JSON.stringify(plan.jobs).replaceAll("'","''");
   const result=sql(`begin; select pg_advisory_xact_lock(71913204); with input as(select * from jsonb_populate_recordset(null::research.work_queue,'${body}'::jsonb)), inserted as(insert into research.work_queue(queue_name,job_type,dedupe_key,priority,status,max_attempts,payload) select queue_name,job_type,dedupe_key,priority,status,max_attempts,payload from input i where not exists(select 1 from research.work_queue q where q.dedupe_key=i.dedupe_key) returning id) select count(*) from inserted; commit;`);
   console.log(JSON.stringify({applied:true,result,planned:plan.jobs.length,blocked:plan.blocked}));
 } else console.log(JSON.stringify({applied:false,planned:plan.jobs.length,blocked:plan.blocked}));
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) main();
