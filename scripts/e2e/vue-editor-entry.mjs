// Actual launcher component with mocked copy API and navigation, not live auth.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { build } from "esbuild";
import { chromium } from "@playwright/test";

const compiled = await build({
  stdin: {contents: "import React from 'react';import {createRoot} from 'react-dom/client';import {TryVueEditorButton} from './src/components/adstudio/vue-editor/try-vue-editor-button';createRoot(document.getElementById('root')).render(<React.StrictMode><TryVueEditorButton adId='original-ad' workspaceId='workspace-1' automatic /></React.StrictMode>);",loader:"tsx",resolveDir:process.cwd()},
  bundle:true,write:false,format:"esm",jsx:"automatic",define:{"process.env.NODE_ENV":'"development"'},tsconfig:"tsconfig.json",
  plugins:[{name:"router",setup(b){
    b.onResolve({filter:/^next\/navigation$/},()=>({path:"router",namespace:"mock"}));
    b.onResolve({filter:/^next\/link$/},()=>({path:"link",namespace:"link"}));
    b.onLoad({filter:/.*/,namespace:"link"},()=>({contents:"import React from 'react';export default function Link(props){return React.createElement('a',props);}",loader:"js",resolveDir:process.cwd()}));
    b.onLoad({filter:/.*/,namespace:"mock"},()=>({contents:"const router={replace:path=>window.lastNavigation=path};export const useRouter=()=>router;"}));
  }}],
});
let calls=0,fail=true;
const server=createServer(async(req,res)=>{
  if(req.url==="/app.js"){res.setHeader("Content-Type","text/javascript");res.end(compiled.outputFiles[0].contents);return;}
  if(req.url.startsWith("/api/")){
    assert.equal(req.method,"POST");assert.equal(req.url,"/api/adstudio/ads/original-ad/vue-copy?workspaceId=workspace-1");calls++;
    res.writeHead(fail?503:200,{"Content-Type":"application/json"}).end(JSON.stringify(fail?{error:"Try again"}:{ad:{adId:"native-ad"}}));return;
  }
  res.setHeader("Content-Type","text/html");res.end('<div id="root"></div><script type="module" src="/app.js"></script>');
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch({executablePath:"/usr/bin/google-chrome",args:["--no-sandbox"]});
try {
  const page=await browser.newPage();
  page.on("pageerror",error=>console.error(error.message));
  await page.goto("http://127.0.0.1:"+server.address().port);
  await page.getByRole("alert").waitFor();
  assert.equal(calls,1,"StrictMode does not launch duplicate requests");
  fail=false;
  await page.getByRole("button",{name:"Try again",exact:true}).click();
  await page.waitForFunction(()=>window.lastNavigation==="/ad-studio/ads/native-ad/canvas");
  assert.equal(calls,2,"retry launches once");
  await page.reload();
  await page.waitForFunction(()=>window.lastNavigation==="/ad-studio/ads/native-ad/canvas");
  assert.equal(calls,3,"reopening follows the server's stable native ID");
  console.log("PASS default launcher: automatic POST, StrictMode guard, error, retry, redirect, reopen");
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
