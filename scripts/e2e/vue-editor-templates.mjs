// Read-only audit of every active template in the bundled Vue/Fabric editor.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { readdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import { build } from 'esbuild';
import serviceModule from '../../src/lib/supabase/service.ts';
import galleryModule from '../../src/lib/adstudio/pack-gallery.ts';
import fabricModule from '../../src/components/adstudio/vue-editor/fabric-scene.ts';

const { createSupabaseServiceClient } = serviceModule;
const { parseTemplateJson, templateAssetStoragePath } = galleryModule;
const { convertTemplateToFabricScenes, nativeTemplateFonts } = fabricModule;
const out = process.env.VUE_EDITOR_EVIDENCE_DIR || '/root/work/adstudio-all-templates-final';
const storageRoot = '/var/lib/docker/volumes/blockwise-product-storage-data/_data/blockwise/blockwise/workspace-artifacts';
async function localStorageBytes(path) {
  const dir = resolve(storageRoot, ...path.split('/').map(decodeURIComponent));
  if (!dir.startsWith(storageRoot + '/')) throw new Error('Storage path outside template bucket');
  try { const entries = await readdir(dir); if (entries.length !== 1) throw new Error('Expected exactly one storage object version'); return await readFile(resolve(dir, entries[0])); } catch { return null; }
}
const service = createSupabaseServiceClient();
const inventory = await service.from('ad_templates').select('template_id,template_json,created_at').eq('library_status','active').order('created_at',{ascending:false});
if (inventory.error) throw new Error(inventory.error.message);
const templates = (inventory.data ?? []).flatMap(row => { const template = parseTemplateJson(row.template_json); return template ? [{row,template}] : []; });
assert.equal(templates.length, inventory.data.length, 'Every active template must parse');
if (!templates.length) throw new Error('No active templates available');
await mkdir(out,{recursive:true});
console.log(JSON.stringify({status:'inventory',activeRows:inventory.data?.length??0,parsedTemplates:templates.length,output:out}));
const assetsById = new Map();
for (const {row,template} of templates) {
  const q = await service.from('ad_template_assets_direct').select('asset_key,file_name,mime_type,storage_path').eq('template_id',row.template_id);
  if (q.error) throw new Error(`${row.template_id}: ${q.error.message}`);
  const map = new Map();
  for (const a of q.data ?? []) {
    const declared = template.assets[a.asset_key]; const expected = templateAssetStoragePath(template.templateId,a.asset_key,a.file_name);
    let status='ok',reason=null,bytes=null;
    if (!declared) { status='undeclared-row'; reason='row not declared'; }
    else if (a.file_name!==declared.fileName || a.mime_type!==declared.mimeType || a.storage_path!==expected) { status='metadata-mismatch'; reason='row differs from declaration'; }
    else { bytes=await localStorageBytes(expected); if(!bytes){status='download-failed';reason='local storage object not found';} }
    map.set(a.asset_key,{...a,status,reason,bytes});
  }
  for(const [key,d] of Object.entries(template.assets)) if(!map.has(key)) map.set(key,{asset_key:key,file_name:d.fileName,mime_type:d.mimeType,status:'missing-row',reason:'declared asset has no row',bytes:null});
  assetsById.set(template.templateId,map);
}
const helper = await build({stdin:{contents:`import { hydrateFabricSceneImages } from './src/components/adstudio/vue-editor/fabric-scene.ts'; window.hydrate=hydrateFabricSceneImages;`,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser',target:'es2020',tsconfig:'tsconfig.json'});
let config=null; const root=resolve('public/vue-ad-editor');
const policy="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; connect-src 'self' blob:; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";
const html=()=>'<html><head><meta charset="utf-8"></head><body><script>window.auditConfig='+JSON.stringify(config).replace(/</g,'\\u003c')+';window.messages=[];function send(type,payload,id){document.querySelector("iframe").contentWindow.postMessage({channel:"blockwise.vue-editor",version:1,type,payload,requestId:id},location.origin)}window.addEventListener("message",async e=>{if(e.origin!==location.origin||e.source!==document.querySelector("iframe").contentWindow)return;messages.push(e.data);if(e.data.type==="ready"){try{const c=window.auditConfig;const f=c.reopen?c.feed:await hydrate(c.feed),s=c.reopen?c.story:await hydrate(c.story);send("initialize",{placements:{feed:{width:1080,height:1350,scene:f},story:{width:1080,height:1920,scene:s}},activePlacement:"feed",fonts:c.fonts});}catch(x){window.hydrationError=String(x)}}});</script><script src="/helper.js"></script><iframe title="Editor" src="/vue-ad-editor/index.html" style="width:100vw;height:100vh"></iframe></body></html>';
const server=createServer(async(req,res)=>{const p=new URL(req.url,'http://localhost').pathname;try{if(p==='/'){res.setHeader('content-type','text/html');res.end(html());return}if(p==='/helper.js'){res.setHeader('content-type','text/javascript');res.end(helper.outputFiles[0].text);return}const m=p.match(/^\/api\/adstudio\/templates\/([^/]+)\/assets\/([^/]+)$/);if(m){const a=assetsById.get(decodeURIComponent(m[1]))?.get(decodeURIComponent(m[2]));if(!a?.bytes){res.writeHead(404).end();return}res.setHeader('content-type',a.mime_type);res.end(a.bytes);return}if(p.startsWith('/fonts/adstudio/')){const file=resolve('public/fonts/adstudio',decodeURIComponent(p.split('/').pop()));if(!file.startsWith(resolve('public/fonts/adstudio')+'/'))throw Error('outside fonts');res.setHeader('content-type','font/woff2');res.end(await readFile(file));return}if(p.startsWith('/vue-ad-editor/')){const file=resolve(root,p.slice('/vue-ad-editor/'.length));if(!file.startsWith(root+'/'))throw Error('outside bundle');res.setHeader('content-security-policy',policy);res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.otf':'font/otf','.svg':'image/svg+xml'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));return}res.writeHead(404).end()}catch(e){res.writeHead(500).end(String(e))}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`, browser=await chromium.launch({executablePath:process.env.ADSTUDIO_E2E_CHROMIUM||'/usr/bin/google-chrome',args:['--no-sandbox']}), page=await browser.newPage({viewport:{width:1440,height:960}}), results=[];
const scan=(scene,placement)=>{const unsupported=[],emptyText=[];const visit=o=>{if(!['rect','image','textbox','i-text','text','group'].includes(o.type))unsupported.push({id:o.id,type:o.type});if(['textbox','i-text','text'].includes(o.type)&&!String(o.text??'').trim())emptyText.push(o.id);for(const c of o.objects??[])visit(c)};for(const o of scene.objects)visit(o);return{placement,width:scene.width,height:scene.height,layers:scene.objects.length,unsupported,emptyText}};

async function message(type,id) {
  await page.waitForFunction(({type,id})=>window.hydrationError||window.messages.some(m=>m.type==='error'||(m.type===type&&(!id||m.requestId===id))),{type,id},{timeout:15000});
  const state=await page.evaluate(({type,id})=>({error:window.hydrationError||window.messages.find(m=>m.type==='error')?.payload,reply:window.messages.find(m=>m.type===type&&(!id||m.requestId===id))}),{type,id});
  if(state.error)throw Error(JSON.stringify(state.error));
  return state.reply.payload;
}
try {
for(const {template} of templates.filter(t=>!process.env.AUDIT_TEMPLATE||t.template.templateId===process.env.AUDIT_TEMPLATE)) {
  const id=template.templateId,dir=resolve(out,id),assets=assetsById.get(id);
  await mkdir(dir,{recursive:true});
  const scenes=convertTemplateToFabricScenes({pack:template,adId:'audit-'+id});
  const fonts=nativeTemplateFonts(template,'audit-'+id);
  const report={templateId:id,title:template.metadata?.title,assets:[...assets.values()].map(a=>({key:a.asset_key,file:a.file_name,mime:a.mime_type,status:a.status,reason:a.reason,bytes:a.bytes?.length??0})),fonts,feed:scan(scenes.feed,'feed'),story:scan(scenes.story,'story')};
  try {
    assert.ok(report.assets.every(a=>a.status==='ok'),'All declared asset bytes and metadata must exist');
    config={feed:scenes.feed,story:scenes.story,fonts};
    await page.goto(origin);
    await message('initialized');
    const loaded=await page.frames().find(f=>f.url().includes('/vue-ad-editor/')).evaluate(()=>[...document.fonts].map(f=>({family:f.family,status:f.status})));
    for(const font of fonts)assert.ok(loaded.some(f=>f.family.replace(/^['"]|['"]$/g,'')===font.family&&f.status==='loaded'),'Loaded font '+font.family);
    report.loadedFonts=loaded;
    await page.evaluate(()=>send('snapshot',undefined,'first'));
    const first=await message('snapshot','first');
    for(const placement of ['feed','story']) {
      assert.ok(!JSON.stringify(first[placement].scene).includes('templateTextBox'),'Initial fitting markers must not alter saved user sizing');
      const png=Buffer.from(first[placement].pngDataUrl.split(',')[1],'base64'),info=await sharp(png).metadata();
      assert.equal(info.width,1080);assert.equal(info.height,placement==='feed'?1350:1920);
      await writeFile(resolve(dir,placement+'.png'),png);
    }
    config={feed:first.feed.scene,story:first.story.scene,fonts,reopen:true};
    await page.reload();await message('initialized');
    await page.evaluate(()=>send('snapshot',undefined,'reopened'));
    const reopened=await message('snapshot','reopened');
    for(const placement of ['feed','story']) {
      if(reopened[placement].pngDataUrl!==first[placement].pngDataUrl) {
        await writeFile(resolve(dir,placement+'-scenes.json'),JSON.stringify({first:first[placement].scene,reopened:reopened[placement].scene},null,2));
        await writeFile(resolve(dir,placement+'-reopened.png'),Buffer.from(reopened[placement].pngDataUrl.split(',')[1],'base64'));
        throw Error(placement+' saved scene reopens with pixel drift');
      }
    }
    report.reopen='pixel-identical';
    report.status='passed';
  } catch(error) {report.status='failed';report.error=String(error)}
  await writeFile(resolve(dir,'report.json'),JSON.stringify(report,null,2));
  results.push(report);console.log(JSON.stringify({templateId:id,status:report.status,error:report.error}));
}
const thumbs=[];
for(const r of results)for(const placement of ['feed','story'])try{
  thumbs.push({label:r.templateId+' '+placement,buf:await sharp(resolve(out,r.templateId,placement+'.png')).resize({width:162,height:240,fit:'inside'}).png().toBuffer()});
}catch{}
for(let start=0;start<thumbs.length;start+=24){
  const batch=thumbs.slice(start,start+24),overlays=[];
  for(let i=0;i<batch.length;i++) {
    overlays.push({input:batch[i].buf,left:(i%6)*180,top:Math.floor(i/6)*270});
    const label=batch[i].label.replace(/[&<>"]/g,'');
    overlays.push({input:Buffer.from('<svg width="180" height="30"><text x="2" y="12" font-size="7">'+label+'</text></svg>'),left:(i%6)*180,top:Math.floor(i/6)*270+240});
  }
  await sharp({create:{width:1080,height:Math.ceil(batch.length/6)*270,channels:3,background:'white'}}).composite(overlays).png().toFile(resolve(out,'contact-'+(start/24+1)+'.png'));
}
await writeFile(resolve(out,'summary.json'),JSON.stringify({status:results.length>0&&results.every(r=>r.status==='passed')?'passed':'failed',activeTemplates:templates.length,testedTemplates:results.length,results},null,2));
} finally {await browser.close();server.close();}
