import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("OSS product compose is isolated and has no managed deployment endpoint", async () => {
  const compose = await read("infra/coolify/docker-compose.product.yml");
  assert.match(compose, /name: blockwise-product/);
  assert.match(compose, /postgres:17\.6-alpine/);
  assert.match(compose, /postgrest\/postgrest:v14\.15/);
  assert.match(compose, /supabase\/gotrue:v2\.189\.0/);
  assert.match(compose, /supabase\/storage-api:v1\.60\.4/);
  assert.match(compose, /supabase\/realtime:v2\.102\.3/);
  assert.match(compose, /blockwise-product-db-data/);
  assert.match(compose, /blockwise-product-storage-data/);
  assert.match(compose, /PGRST_DB_URI: postgres:\/\/\$\{BLOCKWISE_DB_AUTHENTICATOR/);
  assert.match(compose, /wal_level=logical/);
  assert.match(compose, /max_replication_slots=10/);
  assert.match(compose, /profiles: \[worker\]/);
  assert.match(compose, /profiles: \[edge\]/);
  assert.match(compose, /BLOCKWISE_PRODUCT_HTTP_BIND:-127\.0\.0\.1/);
  assert.match(compose, /BLOCKWISE_PRODUCT_HTTP_PORT:-8080/);
  assert.doesNotMatch(compose, /ports: \["80:80", "443:443"\]/);
  assert.match(compose, /Host: \$\$\{BLOCKWISE_PRODUCT_DOMAIN\}/);
  assert.match(compose, /test: \[CMD, "postgrest", "--ready"\]/);
  assert.match(compose, /API_EXTERNAL_URL: \$\{BLOCKWISE_AUTH_API_EXTERNAL_URL:\?/);
  assert.match(compose, /GOTRUE_JWT_AUD: authenticated/);
  assert.match(compose, /AUTH_JWT_SECRET: \$\{BLOCKWISE_AUTH_JWT_SECRET\}/);
  assert.match(compose, /RLIMIT_NOFILE: "10000"/);
  assert.match(compose, /SEED_SELF_HOST: "true"/);
  assert.match(compose, /DB_NAMESPACE: auth/);
  assert.match(compose, /search_path%3Dauth%2Cpublic/);
  assert.match(compose, /search_path%3Dstorage%2Cpublic/);
  assert.match(compose, /BLOCKWISE_WORKER_EXPECTED_REVISION/);
  assert.match(compose, /NEXT_PUBLIC_APP_URL/);
  assert.match(compose, /BLOCKWISE_READINESS_SUPABASE_URL: http:\/\/product-rest:3000/);
  assert.match(compose, /test: \[CMD, "node", "-e", "fetch\('http:\/\/127\.0\.0\.1:3000\/api\/health'/);
  assert.match(compose, /OPENAI_API_KEY/);
  assert.match(compose, /CRON_SECRET/);
  assert.match(compose, /OPENAI_API_KEY: \$\{OPENAI_API_KEY:-\}/);
  assert.match(compose, /META_APP_ID: \$\{META_APP_ID:-\}/);
  assert.match(compose, /META_APP_SECRET: \$\{META_APP_SECRET:-\}/);
  assert.match(compose, /CRON_SECRET: \$\{CRON_SECRET:-\}/);
  assert.doesNotMatch(compose, /(?:OPENAI_API_KEY|META_APP_ID|META_APP_SECRET|CRON_SECRET): \$\{[^}]+:\?/);
  for (const key of [
    "GOOGLE_AI_API_KEY",
    "AZURE_OPENAI_API_KEY",
    "AZURE_OPENAI_ENDPOINT",
    "AZURE_OPENAI_DEPLOYMENT",
    "DEEPSEEK_API_KEY",
    "GOOGLE_ADS_ENABLED",
    "META_MONITOR_BUDGET_AUD",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_WHATSAPP_FROM",
    "ALERT_WHATSAPP_TO",
    "VERCEL_SPEND_WEBHOOK_SECRET",
  ]) assert.match(compose, new RegExp(`^\\s+${key}:`, "m"));
  assert.doesNotMatch(compose, /product-app:[\s\S]*?env_file:/);
  const bootstrap = await read("infra/product/db-init/001-compatibility.sql");
  assert.match(bootstrap, /GRANT anon, authenticated, service_role TO authenticator/);
  assert.match(bootstrap, /FUNCTION auth\.role\(\)/);
  assert.match(bootstrap, /SCHEMA IF NOT EXISTS _realtime/);
  assert.match(bootstrap, /CREATE PUBLICATION supabase_realtime/);
  assert.match(bootstrap, /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public[\s\S]*GRANT ALL ON TABLES TO service_role/);
  assert.doesNotMatch(bootstrap, /GRANT ALL ON TABLES TO anon, authenticated/);
  const apiGrants = await read("infra/product/post-migrate-api-grants.sql");
  assert.match(apiGrants, /class\.relrowsecurity/);
  assert.match(apiGrants, /TO authenticated/);
  assert.doesNotMatch(apiGrants, /TO anon/);
  assert.match(apiGrants, /ALL ON ALL TABLES IN SCHEMA public TO service_role/);
  const rolePassword = await read("infra/product/db-init/002-roles.sh");
  assert.match(rolePassword, /ALTER ROLE authenticator PASSWORD/);
  assert.match(rolePassword, /<<'SQL'/);
  assert.doesNotMatch(rolePassword, /-c\s+"ALTER ROLE authenticator/);
  assert.doesNotMatch(compose, /vercel\.app|supabase\.co|supabase\.com/);

  const productCaddy = await read("infra/product/Caddyfile");
  assert.match(productCaddy, /^http:\/\/\{\$BLOCKWISE_PRODUCT_DOMAIN\} \{/m);
  assert.doesNotMatch(productCaddy, /^\{\$BLOCKWISE_PRODUCT_DOMAIN\} \{/m);

  const envExample = await read("infra/product/.env.example");
  assert.match(envExample, /^OPENAI_API_KEY=$/m);
  assert.match(envExample, /^META_APP_ID=$/m);
  assert.match(envExample, /^META_APP_SECRET=$/m);
  assert.match(envExample, /^BLOCKWISE_DB_VOLUME_NAME=blockwise-product-db-data$/m);
  assert.match(envExample, /^BLOCKWISE_STORAGE_VOLUME_NAME=blockwise-product-storage-data$/m);
  assert.ok(compose.includes("name: " + String.fromCharCode(36) + "{BLOCKWISE_DB_VOLUME_NAME:-blockwise-product-db-data}"));
  assert.ok(compose.includes("name: " + String.fromCharCode(36) + "{BLOCKWISE_STORAGE_VOLUME_NAME:-blockwise-product-storage-data}"));

  const dockerfile = await read("infra/product/Dockerfile");
  assert.match(dockerfile, /ENV HOSTNAME=0\.0\.0\.0/);
  const workspaceManifestCopy = dockerfile.search(/^COPY packages\/ad-template-contract\/package.json/m);
  const npmCi = dockerfile.search(/^RUN npm ci --ignore-scripts$/m);
  assert.ok(npmCi > workspaceManifestCopy, "npm ci must see workspace manifests");
  assert.ok(workspaceManifestCopy >= 0, "Docker must copy workspace manifests before npm ci");
  const packageJson = JSON.parse(await read("package.json"));
  assert.equal(packageJson.scripts["build:packages"], "npm run --workspace @blockwise/ad-template-contract build && npm run --workspace @blockwise/ad-template-renderer build");
  assert.equal(packageJson.scripts.prebuild, "npm run build:packages");
  assert.equal(packageJson.scripts.pretypecheck, "npm run build:packages");
  const workspaceBuild = dockerfile.search(/^RUN npm run build:packages$/m);
  const nextBuild = dockerfile.search(/^RUN npm run build$/m);
  assert.ok(workspaceBuild >= 0, "Docker must build internal workspace packages");
  assert.ok(nextBuild > workspaceBuild, "Next build must run after internal workspace packages");
});

test("product readiness is fatal while liveness remains process-only", async () => {
  const [health, live, migration, script] = await Promise.all([
    read("src/app/api/health/route.ts"),
    read("src/app/api/health/live/route.ts"),
    read("scripts/vps/product-migrate.sh"),
    read("scripts/vps/product-health.sh"),
  ]);
  assert.match(health, /const status = ready \? 200 : 503/);
  assert.match(health, /\{ status \}/);
  assert.match(health, /new URL\("workspaces", `\$\{directPostgrestUrl\.replace/);
  assert.match(health, /supabaseServerCredentialHeaders\(credential\)/);
  assert.match(live, /status: "alive"/);
  assert.match(migration, /notify pgrst, 'reload schema'/i);
  assert.match(migration, /notify pgrst, 'reload config'/i);
  assert.match(migration, /compose restart product-rest/);
  assert.match(script, /\/api\/health/);
  assert.match(script, /status.*ready/);
});

test("migration apply paths are explicitly gated", async () => {
  const scripts = await Promise.all([
    read("scripts/vps/product-import.sh"),
    read("scripts/vps/product-restore.sh"),
    read("scripts/vps/product-migrate.sh"),
    read("scripts/vps/product-cutover.sh"),
    read("scripts/vps/product-rollback.sh"),
  ]);
  for (const script of scripts) assert.match(script, /--apply/);
  assert.match(scripts[0], /I_HAVE_VERIFIED_THE_BACKUP/);
  assert.match(scripts[3], /I_HAVE_VERIFIED_BACKUPS_AND_ROLLBACK/);
  assert.match(scripts[4], /I_HAVE_VERIFIED_THE_ROLLBACK_PLAN/);
  assert.match(scripts[0], /--public-only/);
  assert.match(scripts[0], /--data-only/);
  assert.match(scripts[0], /--single-transaction/);
  assert.match(scripts[0], /--exit-on-error/);
  assert.match(scripts[0], /stop_product_writers/);
  assert.doesNotMatch(scripts[0], /\|\| true/);
  assert.match(scripts[1], /--exit-on-error/);
  assert.match(scripts[1], /--single-transaction/);
  assert.match(scripts[1], /globals/);
  assert.match(scripts[1], /stop_product_writers/);
  assert.doesNotMatch(scripts[1], /\|\| true/);
  assert.match(scripts[2], /product-migrations\.txt/);
  assert.match(scripts[2], /migration_ledger/);
  assert.match(scripts[2], /validate_allowlist/);
  assert.match(scripts[2], /pg_advisory_xact_lock/);
  assert.doesNotMatch(scripts[2], /find "\$MIGRATION_DIR"/);
});

test("phased product exports and public/Auth imports fail closed around data and FK boundaries", async () => {
  const [exporter, importer, authImporter, runbook] = await Promise.all([
    read("scripts/vps/product-export.sh"),
    read("scripts/vps/product-import.sh"),
    read("scripts/vps/product-auth-import.sh"),
    read("docs/runbooks/oss-product-migration.md"),
  ]);
  const perSchemaExport = [...exporter.matchAll(/for schema in [\s\S]*?^done$/gm)].at(-1)?.[0] ?? "";
  assert.match(perSchemaExport, /pg_dump --format=custom --data-only/);
  assert.match(perSchemaExport, /--schema="\$schema"/);

  const targetCountGuard = importer.match(/TARGET_ROWS=.*?^if \[\[/ms)?.[0] ?? "";
  assert.match(targetCountGuard, /where schemaname = 'public'/);
  assert.doesNotMatch(targetCountGuard, /'auth'|'storage'|'private'/);
  assert.match(targetCountGuard, /begin;/i);
  assert.match(targetCountGuard, /commit;/i);
  assert.match(importer, /rolsuper/);
  assert.match(importer, /--disable-triggers/);
  assert.match(importer, /--single-transaction/);
  assert.match(importer, /t\.tgenabled = 'D'/);

  assert.match(authImporter, /I_HAVE_ACCEPTED_FORCED_REAUTHENTICATION/);
  assert.match(authImporter, /--table=auth\.users/);
  assert.match(authImporter, /--table=auth\.identities/);
  assert.match(authImporter, /--single-transaction/);
  assert.match(authImporter, /ORPHAN_IDENTITIES/);
  assert.doesNotMatch(authImporter, /--table=auth\.(sessions|refresh_tokens|schema_migrations)/);
  assert.match(authImporter, /forced_reauthentication=true/);

  assert.match(runbook, /data-only/i);
  assert.match(runbook, /preloaded Auth/i);
  assert.match(runbook, /disable-triggers/i);
});

test("product env contract contains compatibility endpoints but no managed URL", async () => {
  const env = await read("infra/product/.env.example");
  assert.match(env, /NEXT_PUBLIC_SUPABASE_URL=https:\/\/blockwise\.sale/);
  assert.match(env, /BLOCKWISE_AUTH_JWT_SECRET=/);
  assert.match(env, /BLOCKWISE_AUTH_SERVICE_KEY=/);
  assert.match(env, /NEXT_PUBLIC_APP_URL=/);
  assert.match(env, /OPENAI_API_KEY=/);
  assert.match(env, /CRON_SECRET=/);
  assert.match(env, /BLOCKWISE_WORKER_EXPECTED_REVISION=/);
  for (const key of [
    "GOOGLE_AI_API_KEY",
    "AZURE_OPENAI_API_KEY",
    "AZURE_OPENAI_ENDPOINT",
    "AZURE_OPENAI_DEPLOYMENT",
    "AZURE_OPENAI_API_VERSION",
    "DEEPSEEK_API_KEY",
    "GOOGLE_ADS_ENABLED",
    "META_MONITOR_BUDGET_AUD",
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_WHATSAPP_FROM",
    "ALERT_WHATSAPP_TO",
    "VERCEL_SPEND_WEBHOOK_SECRET",
  ]) assert.match(env, new RegExp(`^${key}=`, "m"));
  assert.doesNotMatch(env, /supabase\.co|vercel\.app/);
});

test("OSS product build and reconciliation contracts avoid local secrets and estimates", async () => {
  const [dockerignore, productDockerignore, rows, rowSql, objects, migrations] = await Promise.all([
    read(".dockerignore"),
    read("infra/product/Dockerfile.dockerignore"),
    read("scripts/vps/product-row-counts.sh"),
    read("scripts/vps/product-row-counts.sql"),
    read("scripts/vps/product-object-copy.sh"),
    read("infra/product/product-migrations.txt"),
  ]);
  assert.match(dockerignore, /\.env\*/);
  assert.match(dockerignore, /\.secrets/);
  assert.match(productDockerignore, /\.env\*/);
  assert.match(productDockerignore, /node_modules/);
  assert.match(rows, /product-row-counts\.sql/);
  assert.match(rowSql, /count\(\*\)/i);
  assert.match(rowSql, /set role postgres;/i);
  assert.match(rowSql, /begin;/i);
  assert.match(rowSql, /commit;/i);
  assert.doesNotMatch(rowSql, /reltuples|n_live_tup/);
  assert.doesNotMatch(rows, /reltuples|n_live_tup/);
  assert.match(objects, /product-storage-api-import\.mjs/);
  assert.match(objects, /BLOCKWISE_STORAGE_IMPORT_APPROVED/);
  assert.match(objects, /http:\/\/product-storage:5000/);
  assert.match(objects, /--network blockwise-product/);
  assert.match(objects, /--wait --wait-timeout 180/);
  assert.match(objects, /--user "\$HOST_UID:\$HOST_GID"/);
  assert.match(objects, /chmod 600 "\$RECEIPT"/);
  assert.doesNotMatch(objects, /docker volume inspect|volume:/);
  const storageImporter = await read("scripts/vps/product-storage-api-import.mjs");
  assert.match(storageImporter, /object\/authenticated/);
  assert.match(storageImporter, /x-upsert/);
  assert.match(storageImporter, /target object-name reconciliation failed/);
  assert.match(storageImporter, /target bucket must exist and remain private/);
  assert.match(storageImporter, /BLOCKWISE_STORAGE_FILE_SIZE_LIMIT/);
  assert.match(storageImporter, /source changed after preflight/);
  assert.match(storageImporter, /source checksum mismatch/);
  assert.doesNotMatch(storageImporter, /FILE_STORAGE_BACKEND_PATH|docker volume/);
  const common = await read("scripts/vps/product-common.sh");
  const health = await read("scripts/vps/product-health.sh");
  const postDeploy = await read("scripts/vps/product-post-deploy.sh");
  assert.match(common, /read_env_value/);
  assert.match(common, /compose_with_all_profiles/);
  assert.doesNotMatch(common, /source "\$ENV_FILE"/);
  assert.match(health, /--resolve/);
  assert.match(health, /BLOCKWISE_PUBLIC_URL/);
  assert.match(postDeploy, /product-health\.sh/);
  assert.match(postDeploy, /\/projects\/frank\/apps\/window\/infra\/control_plane\/post-deploy\.sh/);
  assert.match(postDeploy, /healthy but post-deploy reconciliation failed/);
  assert.doesNotMatch(postDeploy, /docker (?:compose|run|exec)|systemctl/);
  const allowlistedMigrations = migrations
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  assert.ok(allowlistedMigrations.includes("202605260001_initial_blockwise.sql"));
  const migrationFiles = (await readdir("supabase/migrations"))
    .filter((name) => name.endsWith(".sql"));
  const allowlistBaseline = "20260830020000_direct_template_artifact.sql";
  const futureProductionMigrations = migrationFiles.filter((name) =>
    name > allowlistBaseline && !/research|apify/i.test(name));
  assert.deepEqual(
    futureProductionMigrations.filter((name) => !allowlistedMigrations.includes(name)),
    [],
    "new production migrations must be added to the product allowlist",
  );
  assert.ok(allowlistedMigrations.every((line) => !/research|hermes/i.test(line)));
  assert.deepEqual([...allowlistedMigrations].sort(), allowlistedMigrations);
});

test("direct Hermes artifacts and customer saves use the self-hosted transaction boundary", async () => {
  const [migration, migrations, ingest, saver] = await Promise.all([
    read("supabase/migrations/20260829010000_adstudio_transactional_writes.sql"),
    read("infra/product/product-migrations.txt"),
    read("src/lib/adstudio/ingest-artifact.ts"),
    read("src/lib/adstudio/save-ad.ts"),
  ]);
  assert.match(migrations, /20260830020000_direct_template_artifact\.sql/);
  assert.match(migration, /create or replace function public\.commit_ad_revision/);
  assert.match(migration, /alter table public\.ad_customer_ads enable row level security/);
  assert.match(ingest, /adTemplateSchema/);
  assert.match(ingest, /template_artifact_conflict/);
  assert.match(ingest, /ad_template_assets_direct/);
  assert.doesNotMatch(ingest, /ad_import_receipts|signature.*verify|packUrl/);
  assert.match(saver, /commit_ad_revision/);
});

test("new VPS shell entrypoints are staged with executable Git modes", async () => {
  const files = [
    "infra/product/db-init/002-roles.sh",
    "scripts/vps/product-auth-import.sh",
    "scripts/vps/product-backup.sh",
    "scripts/vps/product-checksums.sh",
    "scripts/vps/product-common.sh",
    "scripts/vps/product-cutover.sh",
    "scripts/vps/product-export.sh",
    "scripts/vps/product-health.sh",
    "scripts/vps/product-import.sh",
    "scripts/vps/product-migrate.sh",
    "scripts/vps/product-object-copy.sh",
    "scripts/vps/product-post-deploy.sh",
    "scripts/vps/product-restore.sh",
    "scripts/vps/product-rollback.sh",
    "scripts/vps/product-row-counts.sh",
  ];
  const staged = execFileSync("git", ["ls-files", "--stage", "--", ...files], { encoding: "utf8" });
  for (const file of files) {
    const line = staged.split(/\r?\n/).find((entry) => entry.endsWith(`\t${file}`));
    assert.match(line ?? "", /^100755 /, `expected executable Git mode for ${file}`);
  }
});
