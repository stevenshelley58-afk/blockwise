import { mkdir, readFile, writeFile, copyFile, readdir } from "node:fs/promises";
import { resolve, dirname, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { EMAIL_TEMPLATES, EMAIL_LIBRARY_VERSION, requiredVariables } from "../../src/lib/email-design/catalog.ts";
import { exampleVariables, renderExample, exampleStates } from "../../src/lib/email-design/examples.ts";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const target = process.argv[2];
if (!target || !isAbsolute(target)) throw new Error("Specify a new absolute VPS output directory");
await mkdir(target, { recursive: true });
if ((await readdir(target)).length) throw new Error("Refusing to overwrite a non-empty library directory");
for (const folder of ["source", "templates", "examples", "assets"]) await mkdir(resolve(target, folder));
const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const files = {};
async function track(path) {
  const contents = await readFile(resolve(target, path));
  files[path] = { bytes: contents.length, sha256: createHash("sha256").update(contents).digest("hex") };
}
async function save(path, contents) { await writeFile(resolve(target, path), contents); await track(path); }
for (const file of ["types.ts", "renderer.ts", "catalog.ts", "catalog-data.json", "examples.ts", "catalog-examples.json", "notification-examples.json"]) {
  await copyFile(resolve(root, "src/lib/email-design", file), resolve(target, "source", file)); await track(`source/${file}`);
}
await copyFile(resolve(root, "scripts/email/render-library.mjs"), resolve(target, "render.mjs")); await track("render.mjs");
await save("package.json", JSON.stringify({ name: "blockwise-email-library", private: true, version: EMAIL_LIBRARY_VERSION, type: "module", engines: { node: ">=22.18.0" } }, null, 2));
await copyFile(resolve(root, "docs/design/email-library.md"), resolve(target, "README.md")); await track("README.md");
// Preserve approved sample imagery beside the reusable templates, with hashes.
// Email URLs remain absolute HTTPS; assets are included for future re-hosting.
const assets = [];
const assetRoot = resolve(root, "public/email-assets");
for (const entry of await readdir(assetRoot, { withFileTypes: true })) {
  if (!entry.isFile() || !/^[a-z0-9-]+\.(?:jpg|jpeg|png)$/.test(entry.name)) continue;
  const relative = `assets/${entry.name}`;
  await copyFile(resolve(assetRoot, entry.name), resolve(target, relative));
  await track(relative);
  assets.push({ file: relative, ...files[relative] });
}
await copyFile(resolve(root, "docs/design/email-ad-assets.md"), resolve(target, "assets/README.md"));
await track("assets/README.md");
const templates = [];
for (const template of EMAIL_TEMPLATES) {
  const output = renderExample(template.id);
  const definition = { ...template, requiredVariables: requiredVariables(template.id) };
  await save(`templates/${template.id}.json`, JSON.stringify(definition, null, 2));
  await save(`examples/${template.id}.values.json`, JSON.stringify(exampleVariables(template.id), null, 2));
  await save(`examples/${template.id}.html`, output.html);
  await save(`examples/${template.id}.txt`, output.text);
  for (const state of exampleStates(template.id).filter(state => state !== "standard")) {
    const variant = renderExample(template.id, "system", state);
    await save(`examples/${template.id}.${state}.values.json`, JSON.stringify(exampleVariables(template.id, state), null, 2));
    await save(`examples/${template.id}.${state}.html`, variant.html);
    await save(`examples/${template.id}.${state}.txt`, variant.text);
  }
  templates.push({ id: template.id, label: template.label, category: template.category, delivery: template.delivery, notificationPreference: template.notificationPreference, exampleStates: exampleStates(template.id), htmlBytes: output.bytes, requiredVariables: definition.requiredVariables });
}
await save("inventory.json", JSON.stringify(templates, null, 2));
const manifest = { version: EMAIL_LIBRARY_VERSION, approvedDesign: "quiet-card", sourceRevision: revision, createdAt: new Date().toISOString(), exampleContentOnly: true, sendingEnabled: false, assets, templates, files };
await writeFile(resolve(target, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ target, revision, templates: templates.length, htmlBytes: { min: Math.min(...templates.map(t => t.htmlBytes)), max: Math.max(...templates.map(t => t.htmlBytes)) } }));
