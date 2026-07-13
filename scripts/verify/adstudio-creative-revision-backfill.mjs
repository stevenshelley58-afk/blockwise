import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const fixturePath = "scripts/verify/fixtures/adstudio-creative-revisions-pre-migration.sql";
const projectIdMatch = readFileSync("supabase/config.toml", "utf8").match(
  /^project_id\s*=\s*"([^"]+)"/m,
);

if (!projectIdMatch) {
  throw new Error("Supabase project_id is missing from supabase/config.toml");
}

const databaseContainer = `supabase_db_${projectIdMatch[1]}`;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }

  return result.stdout.trim();
}

function psql(args, input) {
  return run(
    "docker",
    [
      "exec",
      "-i",
      databaseContainer,
      "psql",
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      "postgres",
      ...args,
    ],
    { input },
  );
}

console.log("Resetting to the schema immediately before the creative revision migration...");
run("supabase", ["db", "reset", "--local", "--version", "202607130002", "--no-seed"]);

console.log("Seeding 427 existing creatives...");
psql([], readFileSync(fixturePath, "utf8"));

const seededCount = psql(["-A", "-t", "-c", "select count(*) from public.adstudio_creatives;"]);
if (seededCount !== "427") {
  throw new Error(`Expected 427 pre-migration creatives, found ${seededCount}`);
}

console.log("Applying the real creative revision migration...");
run("supabase", ["migration", "up", "--local"]);

const result = psql([
  "-A",
  "-t",
  "-F",
  "|",
  "-c",
  `select
    (select count(*) from public.adstudio_creatives),
    (select count(*) from public.adstudio_creative_revisions where creation_operation = 'migration_backfill'),
    (select count(*) from public.adstudio_creatives where active_revision_id is null),
    (select relrowsecurity from pg_class where oid = 'public.adstudio_creative_revisions'::regclass),
    (select count(*) from supabase_migrations.schema_migrations where version = '202607130003');`,
]);

if (result !== "427|427|0|t|1") {
  throw new Error(
    `Creative revision migration verification failed; expected 427|427|0|t|1, received ${result}`,
  );
}

console.log("Creative revision migration backfill verified: 427 revisions, 0 unresolved, RLS enabled.");
