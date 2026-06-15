import { readFileSync } from "node:fs";
import { creativeSkeletonSchema } from "../src/lib/ad-template-library/skeleton.ts";
const seed = JSON.parse(readFileSync("ad-template-library/library-seed.json","utf8"));
let ok=0, bad=0;
for (const t of seed.templates) {
  const r = creativeSkeletonSchema.safeParse(t.creative_skeleton);
  if (r.success) ok++;
  else { bad++; console.log(t.template_key, "INVALID:", JSON.stringify(r.error.issues.slice(0,3))); }
}
console.log(`valid ${ok}/${ok+bad}`);
process.exit(bad?1:0);
