// Component harness with explicitly mocked auth/API boundaries. Not a live-account acceptance test.
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { buildCustomerImageRef } from '../../src/lib/adstudio/customer-image-ref.ts';
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { adDocumentSchema } from '../../packages/ad-template-contract/src/schema.ts';
import { validateNativeEditorDocument, validateNativePngExport } from '../../src/lib/adstudio/vue-native-validation.ts';
const output = process.env.VUE_EDITOR_EVIDENCE_DIR || '/root/work/adstudio-vue-simple-host-20260912';
const photoBytes = await sharp({create:{width:900,height:600,channels:3,background:'#315951'}}).png().toBuffer();
const photoRef = buildCustomerImageRef('workspace-1','trial-ad',createHash('sha256').update(photoBytes).digest('hex'),'image/png');
const originalPhotoBytes = await sharp({create:{width:1200,height:800,channels:3,background:'#57716a'}}).png().toBuffer();
const originalPhotoRef = buildCustomerImageRef('workspace-1','trial-ad',createHash('sha256').update(originalPhotoBytes).digest('hex'),'image/png');
let failNextSave = false, adoptions = 0;
const template = JSON.parse(await readFile('tests/fixtures/ad-template/minimal-feed-story.json', 'utf8'));
template.metadata.title = 'Ad editor test fixture';
template.metadata.metaCopyDefaults = { primaryText: ['Original primary text'], headlines: ['Original headline'], descriptions: ['Original description'], cta: 'LEARN_MORE' };
template.imageInputs = [{key:'photo',label:'Property photo',acceptedTypes:['image/png']}];
template.textInputs = [{ key: 'headline', label: 'On-image headline', placeholder: 'Template headline', maxLength: 80 }];
const scene = height => ({ version:'5.3.0', width:1080, height, objects:[
  { type:'rect', id:'workspace', width:1080, height, left:0, top:0, fill:'#f8f4ec', selectable:false, evented:false, originX:'left', originY:'top' },
  { type:'image', id:'photo', inputKey:'photo', metadata:{blockwiseType:'image_slot',inputKey:'photo'}, src:originalPhotoRef, crossOrigin:'anonymous', width:900, height:600, scaleX:920/900, scaleY:920/900, left:80, top:90, originX:'left', originY:'top' },
  { type:'textbox', id:'headline', inputKey:'headline', text:'Template headline', width:920, left:80, top:800, fontSize:78, fontFamily:'Arial', fill:'#23483e', originX:'left', originY:'top' },
]});
let document = { schema:'blockwise.ad-document', templateId:template.templateId, sharedImageValues:{}, sharedTextValues:{headline:'Template headline'}, feedCropOverrides:{}, storyCropOverrides:{}, colourMode:'template', resolvedColourMap:template.semanticColours, metaPrimaryText:'Original primary text', metaHeadline:'Original headline', metaDescription:'Original description', metaCta:'LEARN_MORE', revision:1, nativeEditor:{engine:'vue-fabric-editor',version:1,sourceAdId:'source-ad',feed:scene(1350),story:scene(1920)} };
let revision = 1, saves = 0, proposals = 0;
const props = () => ({ pack:template, adId:'trial-ad', workspaceId:'workspace-1', initialDocument:document, initialRevision:revision, sourceAdId:'source-ad', businessName:'Synthetic test agency', logoUrl:null, libraryAssets:[{id:'library-photo',name:'Test library photo',url:photoRef}] });
const compiled = await build({
  stdin:{ contents:`import React from 'react'; import {createRoot} from 'react-dom/client'; import {VueEditorShell} from './src/components/adstudio/vue-editor/vue-editor-shell';createRoot(document.getElementById('root')).render(<VueEditorShell {...window.props}/>);`, loader:'tsx', resolveDir:process.cwd() },
  bundle:true, write:false, format:'esm', jsx:'automatic', define:{'process.env.NODE_ENV':'"production"'}, tsconfig:'tsconfig.json',
  plugins:[{name:'test-router',setup(build){build.onResolve({filter:/^next\/navigation$/},()=>({path:'router',namespace:'test'}));build.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const useRouter=()=>({push:path=>{window.lastNavigation=path}});',loader:'js'}));}}],
});
const cssFiles = (await readdir('.next/static/chunks')).filter(file => file.endsWith('.css'));
const css = (await Promise.all(cssFiles.map(file => readFile(resolve('.next/static/chunks', file), 'utf8')))).join('\n');
const policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data: blob:; connect-src 'self' blob:; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'none'";
const server = createServer(async(req,res)=>{
  const path = new URL(req.url,'http://localhost').pathname;
  try {
    if(path==='/'){res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><link rel="stylesheet" href="/test.css"><style>html,body,#root{margin:0;height:100%;}body{font-family:Arial;}</style></head><body class="tw"><div id="root"></div><script>window.props=${JSON.stringify(props())}</script><script type="module" src="/test.js"></script></body></html>`);return;}
    if(path==='/test.js'){res.setHeader('Content-Type','text/javascript');res.end(compiled.outputFiles[0].contents);return;}
    if(path==='/test.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
    if(path.includes('/copy-proposal')){proposals++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({onImage:{headline:'Proposed headline'},copy:{primaryText:'Proposed primary text'},source:'Test fixture'}));return;}
    if(path==='/api/adstudio/customer-media'){res.setHeader('Content-Type','image/png');res.end(req.url===photoRef?photoBytes:originalPhotoBytes);return;}
    if(path.endsWith('/media') && req.method==='POST'){
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const body=JSON.parse(Buffer.concat(chunks).toString());
      assert.equal(body.operation,'adopt');assert.equal(body.sourceAssetId,'library-photo');adoptions++;
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ref:photoRef}));return;
    }
    if(path.includes('/vue-save')){
      if(failNextSave){failNextSave=false;res.writeHead(503,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Test save failure. Try again.'}));return;}

      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const body=JSON.parse(Buffer.concat(chunks).toString());
      assert.equal(body.expectedRevision,revision);
      const parsed=adDocumentSchema.parse(body.document);
      validateNativeEditorDocument({nativeEditor:parsed.nativeEditor,workspaceId:'workspace-1',adId:'trial-ad',templateId:template.templateId});
      await validateNativePngExport(body.exports.feed,'feed');await validateNativePngExport(body.exports.story,'story');
      document=parsed;revision++;saves++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ad:{revisionNumber:revision}}));return;
    }
    if(path.startsWith('/vue-ad-editor')){
      const root=resolve('public/vue-ad-editor');
      const file=resolve(root,path.replace(/^\/vue-ad-editor\/?/,'')||'index.html');
      if(!file.startsWith(root+'/'))throw new Error('outside bundle');
      res.setHeader('Content-Security-Policy',policy);
      res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream');
      res.end(await readFile(file));return;
    }
    res.writeHead(404).end();
  }catch(error){console.error(error.message);res.writeHead(500).end(JSON.stringify({error:error.message}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:960}});
const errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
  await mkdir(output,{recursive:true});await page.goto(origin);
  const save=page.getByRole('button',{name:'Save',exact:true});
  const ready=()=>page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent==='Save'&&!button.disabled));
  await ready();
  await page.getByAltText('Feed creative preview').waitFor();
  assert.equal(await page.locator('iframe').isVisible(),false,'design tools hidden by default');
  assert.equal(await page.locator('iframe').evaluate(el=>el.inert || !!el.closest('[inert]')),true,'hidden editor keyboard inert');
  await page.getByRole('button',{name:'Photos',exact:true}).waitFor();
  await page.getByRole('button',{name:'Words',exact:true}).waitFor();
  await page.evaluate(()=>window.firstFrame=document.querySelector('iframe'));
  await page.screenshot({path:resolve(output,'desktop.png'),fullPage:true});

  // Return immediately after a real native insertion, before delayed changed.
  await page.getByRole('button',{name:'Adjust design',exact:true}).click();
  await page.getByRole('button',{name:'Done designing',exact:true}).waitFor();
  const frame=page.frameLocator('iframe');
  await frame.getByText('Elements',{exact:true}).click();
  await frame.locator('.tool-box > span').first().click();
  await page.getByRole('button',{name:'Done designing',exact:true}).click();
  await page.getByRole('button',{name:'Adjust design',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.firstFrame===document.querySelector('iframe')),true,'mode switch keeps same iframe');
  assert.equal(await page.locator('iframe').isVisible(),false);

  await page.getByRole('button',{name:'Words',exact:true}).click();
  const field=page.getByLabel('On-image headline',{exact:true});
  if(!await field.isVisible()) await page.getByText('Text on image',{exact:true}).click();
  await field.fill('Edited copy');
  await page.getByPlaceholder('What should this ad communicate?').fill('A short example property ad');
  await page.getByRole('button',{name:'Help me write',exact:true}).click();
  await page.getByText('Proposed headline',{exact:false}).waitFor();
  assert.equal(await field.inputValue(),'Edited copy','AI never applies silently');
  await page.getByRole('button',{name:'Apply proposal',exact:true}).click();
  assert.equal(await field.inputValue(),'Proposed headline');
  await page.getByRole('button',{name:'Close',exact:true}).click();

  await page.getByRole('button',{name:'Photos',exact:true}).click();
  await page.getByRole('button',{name:/Property photo/}).click();
  await page.getByRole('button',{name:'Test library photo',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
  assert.equal(adoptions,1);

  failNextSave=true;
  await save.click();await page.getByText('Test save failure. Try again.',{exact:true}).waitFor();
  assert.equal(saves,0);
  await save.click();await page.getByRole('status').filter({hasText:/^Saved$/}).waitFor();
  assert.equal(saves,1);assert.equal(proposals,1);
  assert.equal(document.nativeEditor.feed.objects.find(object=>object.id==='headline').text,'Proposed headline');
  assert.equal(document.nativeEditor.story.objects.find(object=>object.id==='headline').text,'Proposed headline');
  assert.ok(document.nativeEditor.feed.objects.length>3,'native freeform addition survives simple edits');
  assert.equal(document.nativeEditor.story.objects.length,3,'native freeform addition stays placement-specific');
  for(const placement of ['feed','story']) assert.equal(document.nativeEditor[placement].objects.find(object=>object.id==='photo').src,photoRef);
  await page.reload();await ready();
  await page.getByAltText('Feed creative preview').waitFor();
  assert.equal(await page.locator('iframe').isVisible(),false);
  await page.screenshot({path:resolve(output,'ad-preview.png'),fullPage:true});
  await page.getByRole('tab',{name:'Story',exact:true}).click();
  await page.getByAltText('Story creative preview').waitFor();
  await page.getByRole('button',{name:'Review & publish'}).click();
  await page.waitForFunction(()=>window.lastNavigation?.includes('/publish?adId=trial-ad'));

  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});await page.reload();await ready();
    await page.getByAltText('Feed creative preview').waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no mobile page overflow');
    for(const name of ['Photos','Words','Review & publish']){
      const box=await page.getByRole('button',{name,exact:true}).boundingBox();
      assert.ok(box && box.x>=0 && box.x+box.width<=width+.5 && box.y+box.height<=844,name+' reachable at '+width);
    }
    await page.screenshot({path:resolve(output,'mobile-'+width+'.png'),fullPage:true});
    if(width===390){
      await page.getByRole('button',{name:'Words',exact:true}).click();
      await page.screenshot({path:resolve(output,'mobile-words.png'),fullPage:true});
      await page.getByRole('button',{name:'Close',exact:true}).click();
    }
  }
  assert.deepEqual(errors,[]);
  await writeFile(resolve(output,'receipt.json'),JSON.stringify({status:'passed',scope:'mocked component harness; actual native iframe and PNG validators; not signed-in live-account acceptance',saves,proposals,adoptions,checks:['simple default','hidden canvas inert','lossless same-frame design round trip','native element preserved across simple edits','explicit AI proposal/apply','photos in both sizes','save error and retry','native snapshot and validators','save and reopen','Feed/Story ad previews','publish review navigation','desktop and 390/320px mobile']},null,2));
  console.log('Simple-first host harness passed: default ad view, lossless native design roundtrip, copy, AI, photos, save/retry/reopen, review navigation, desktop/mobile.');
}catch(error){await page.screenshot({path:resolve(output,'failure.png'),fullPage:true});console.error({errors,text:await page.locator('body').innerText()});throw error;}
finally{await browser.close();server.close();}
