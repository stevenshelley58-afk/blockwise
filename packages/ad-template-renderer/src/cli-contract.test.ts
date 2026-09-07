import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const cli = join(root, "packages/ad-template-renderer/src/cli.ts");
const fixture = JSON.parse(await readFile(join(root, "tests/fixtures/ad-template/minimal-feed-story.json"), "utf8"));
function run(scratch, artifact) { const path=join(scratch,"artifact.json"); return writeFile(path,JSON.stringify(artifact)).then(()=>spawnSync(process.execPath,["--import","tsx",cli,"--input",path,"--assets-dir",scratch,"--out-dir",join(scratch,"out")],{cwd:root,encoding:"utf8"})); }

test("CLI rejects invalid contract before asset I/O with bounded issues", async()=>{ const s=await mkdtemp(join(tmpdir(),"cli-contract-")); try { const bad={...fixture,template:{...fixture,templateId:"bad",feedLayout:null}}; const r=await run(s,bad); assert.equal(r.status,1); assert.match(r.stderr,/^invalid_template_artifact /); assert.match(r.stderr,/feedLayout/); } finally { await rm(s,{recursive:true,force:true}); } });

test("CLI rejects duplicate, undeclared, and mismatched supplied assets before reads", async()=>{ const s=await mkdtemp(join(tmpdir(),"cli-assets-")); try { const template={...fixture,assets:{hero:{fileName:"hero.png",mimeType:"image/png"}}}; for (const assets of [[{assetKey:"hero",fileName:"hero.png",mimeType:"image/png"},{assetKey:"hero",fileName:"hero.png",mimeType:"image/png"}],[{assetKey:"other",fileName:"hero.png",mimeType:"image/png"}],[{assetKey:"hero",fileName:"wrong.png",mimeType:"image/png"}]]) { const r=await run(s,{template,assets}); assert.equal(r.status,1); assert.match(r.stderr,/invalid_template_artifact/); assert.doesNotMatch(r.stderr,/ENOENT|no such file/); } } finally { await rm(s,{recursive:true,force:true}); } });

test("CLI accepts valid source-free fixture and reaches render step", async()=>{ const s=await mkdtemp(join(tmpdir(),"cli-valid-")); try { const r=await run(s,{template:fixture,assets:[]}); assert.equal(r.status,0,r.stderr); assert.match(r.stdout,/fixture-minimal/); } finally { await rm(s,{recursive:true,force:true}); } });