import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("research compose owns media storage and keeps it private by default", async () => {
  const compose = await read("infra/coolify/docker-compose.research.yml");
  assert.match(compose, /research-storage-db:/);
  assert.match(compose, /research-storage-rest:/);
  assert.match(compose, /research-storage:/);
  assert.match(compose, /supabase\/storage-api:v1\.60\.4@sha256:c8eb9858eafec891a97c27125470aaad54703c3f4eb4d55ca7f1bf6c6411febf/);
  assert.match(compose, /STORAGE_BACKEND: file/);
  assert.match(compose, /GLOBAL_S3_BUCKET: blockwise-research-storage/);
  assert.match(compose, /REGION: local/);
  assert.match(compose, /TENANT_ID: blockwise-research/);
  assert.match(compose, /FILE_STORAGE_BACKEND_PATH: \/var\/lib\/storage/);
  assert.match(compose, /SERVER_PORT: "5000"/);
  assert.match(compose, /UPLOAD_FILE_SIZE_LIMIT:/);
  assert.match(compose, /STORAGE_PUBLIC_URL:/);
  assert.match(compose, /REQUEST_ALLOW_X_FORWARDED_PATH: "true"/);
  assert.match(compose, /research-storage-db-data:/);
  assert.match(compose, /research-storage-data:/);
  assert.match(compose, /research-storage-backup:/);
  assert.match(compose, /wget -qO- http:\/\/127\.0\.0\.1:3000\/ >\/dev\/null \|\| exit 1/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /cap_drop: \[ALL\]/);
  assert.match(compose, /security_opt: \[no-new-privileges:true\]/);
  assert.match(compose, /POSTGRES_PASSWORD_FILE: \/run\/secrets\/research_storage_db_password/);
  assert.match(compose, /research_storage_db_password:[\s\S]*environment: HERMES_RESEARCH_STORAGE_DB_PASSWORD/);
  assert.match(compose, /HERMES_RESEARCH_STORAGE_JWT_SECRET:\?Set/);
  assert.match(compose, /HERMES_RESEARCH_STORAGE_ANON_KEY:\?Set/);
  assert.match(compose, /HERMES_RESEARCH_STORAGE_SERVICE_KEY:\?Set/);
  assert.doesNotMatch(compose, /rustfs|RUSTFS|STORAGE_S3/iu);
  const storageService = compose.match(/research-storage:[\s\S]*?(?=\n  [a-z0-9-]+:|\nvolumes:)/)?.[0] ?? "";
  assert.doesNotMatch(storageService, /\n    ports:/);
  assert.doesNotMatch(compose, /HERMES_CUSTOMER_SUPABASE_URL: \$\{SUPABASE_URL\}/);
  assert.doesNotMatch(compose, /supabase\.co|supabase\.com/);
});

test("research media edge exposes only the public object path", async () => {
  const [edge, internal, publicEdge] = await Promise.all([
    read("infra/caddy/Caddyfile"),
    read("infra/research-db/Caddyfile"),
    read("infra/research-storage/Caddyfile"),
  ]);
  assert.match(edge, /handle_path \/research-media\/\*/);
  assert.match(edge, /blockwise-research-media-gateway:3000/);
  assert.match(internal, /handle_path \/storage\/v1\/\*/);
  assert.match(internal, /blockwise-research-storage:5000/);
  assert.equal((internal.match(/handle_path \/storage\/v1\/\*/g) ?? []).length, 1);
  assert.match(publicEdge, /@publicResearchObjects path \/storage\/v1\/object\/public\/\*/);
  assert.match(publicEdge, /handle @publicResearchObjects/);
  assert.match(publicEdge, /uri strip_prefix \/storage\/v1/);
  assert.match(publicEdge, /blockwise-research-storage:5000/);
  assert.match(publicEdge, /handle \{/);
  assert.match(publicEdge, /respond "not found" 404/);
  assert.doesNotMatch(publicEdge, /handle_path \/storage\/v1/);
});

test("Hermes and customer rendering use separate media URLs", async () => {
  const [supervisor, credentials, config, storageInit, card, productDockerfile, productCompose, env, rootEnv] = await Promise.all([
    read("hermes/tools/research-runtime/bin/supabase-supervisor.mjs"),
    read("hermes/tools/research-runtime/bin/supabase-credentials.mjs"),
    read("hermes/tools/research-runtime/src/config.ts"),
    read("infra/research-storage/init/001-roles.sql"),
    read("src/lib/research/customer-meta-card.ts"),
    read("infra/product/Dockerfile"),
    read("infra/coolify/docker-compose.product.yml"),
    read("infra/product/.env.example"),
    read(".env.example"),
  ]);
  assert.match(supervisor, /HERMES_RESEARCH_STORAGE_URL/);
  assert.match(supervisor, /researchStorageCredential/);
  assert.match(supervisor, /researchStorageUrl\}\/?storage\/v1/);
  assert.doesNotMatch(supervisor, /customerSupabaseUrl\/storage\/v1/);
  assert.match(credentials, /resolveHermesResearchStorageCredential/);
  assert.match(credentials, /must point at Hermes-owned Storage API/);
  assert.match(config, /HERMES_RESEARCH_STORAGE_URL/);
  assert.match(storageInit, /create schema if not exists auth/);
  assert.match(storageInit, /function auth\.uid/);
  assert.match(card, /NEXT_PUBLIC_RESEARCH_STORAGE_URL/);
  assert.match(card, /hostname\.endsWith\("\.supabase\.co"\)/);
  assert.match(productDockerfile, /ARG NEXT_PUBLIC_RESEARCH_STORAGE_URL/);
  assert.match(productCompose, /NEXT_PUBLIC_RESEARCH_STORAGE_URL/);
  assert.match(env, /NEXT_PUBLIC_RESEARCH_STORAGE_URL=https:\/\/hermes\.blockwise\.sale\/research-media/);
  assert.match(rootEnv, /HERMES_RESEARCH_STORAGE_PUBLIC_URL=https:\/\/hermes\.blockwise\.sale\/research-media\/storage\/v1/);
});

test("backfill scripts fail closed without the Hermes storage URL", async () => {
  const [ocr, quality, backup] = await Promise.all([
    read("hermes/tools/research-runtime/bin/ocr-backfill.mjs"),
    read("hermes/tools/research-runtime/bin/media-quality-backfill.mjs"),
    read("scripts/vps/research-storage-backup.sh"),
  ]);
  assert.match(ocr, /Missing HERMES_RESEARCH_STORAGE_URL/);
  assert.match(ocr, /\$\{storageUrl\}\/storage\/v1\/object\/public/);
  assert.match(quality, /Missing HERMES_RESEARCH_STORAGE_URL/);
  assert.match(quality, /\$\{storageUrl\}\/storage\/v1\/object\/public/);
  assert.match(backup, /pg_dump --format=custom/);
  assert.match(backup, /sha256sum/);
});
