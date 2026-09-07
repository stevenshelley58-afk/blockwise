#!/usr/bin/env node
// This command is packaged as render.mjs at the root of the exported library.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildTemplate } from "./source/catalog.ts";
import { renderExample } from "./source/examples.ts";
const [id, input, destination = "rendered"] = process.argv.slice(2);
if (!id || !input) {
  console.error("Usage: node render.mjs <template-id> <values.json|--example> [output-directory]");
  process.exit(1);
}
try {
  const output = input === "--example" ? renderExample(id)
    : buildTemplate(id, JSON.parse(await readFile(resolve(input), "utf8")));
  const directory = resolve(destination);
  await mkdir(directory, { recursive: true });
  const suffix = input === "--example" ? "-SAMPLE" : "";
  await writeFile(resolve(directory, `${id}${suffix}.html`), output.html);
  await writeFile(resolve(directory, `${id}${suffix}.txt`), output.text);
  await writeFile(resolve(directory, `${id}${suffix}.json`), JSON.stringify({ subject: output.subject, delivery: output.delivery, htmlBytes: output.bytes, templateId: id, version: output.version, example: input === "--example" }, null, 2));
  console.log(`Rendered ${id}: ${output.bytes} HTML bytes. No email was sent.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
