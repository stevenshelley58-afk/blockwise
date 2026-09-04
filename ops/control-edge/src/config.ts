import { readFileSync, lstatSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";

export type ControlConfig = {
  port: number;
  host: string;
  internalSecret: string;
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  executorUrl: string;
  executorSecret: string;
  maxBodyBytes: number;
  replayWindowSeconds: number;
  workerEnabled: boolean;
  workerIntervalMs: number;
};

function positiveInt(name: string, fallback: number, min: number, max: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} is invalid`);
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ControlConfig {
  const internalSecret = requiredFileFrom(env, "BLOCKWISE_INTERNAL_AUTH_SECRET_FILE", 4096);
  if (internalSecret.length < 32) throw new Error("internal auth secret is too weak");
  const serviceKey = requiredFileFrom(env, "SUPABASE_SERVICE_ROLE_KEY_FILE", 8192);
  const supabaseUrl = (env.SUPABASE_URL ?? "").trim().replace(/\/$/, "");
  if (!/^https:\/\//i.test(supabaseUrl)) throw new Error("SUPABASE_URL must be HTTPS");
  const executorUrl = (env.BLOCKWISE_ACTION_EXECUTOR_URL ?? "").trim().replace(/\/$/, "");
  if (executorUrl && !/^https:\/\//i.test(executorUrl)) throw new Error("executor URL must be HTTPS");
  const executorSecret = executorUrl ? requiredFileFrom(env, "BLOCKWISE_ACTION_EXECUTOR_SECRET_FILE", 4096) : "";
  if (executorUrl && executorSecret.length < 32) throw new Error("executor auth secret is too weak");
  return {
    port: positiveIntFrom(env, "PORT", 8660, 1, 65535),
    host: env.HOST?.trim() || "127.0.0.1",
    internalSecret,
    supabaseUrl,
    supabaseServiceRoleKey: serviceKey,
    executorUrl,
    executorSecret,
    maxBodyBytes: positiveIntFrom(env, "CONTROL_EDGE_MAX_BODY_BYTES", 128 * 1024, 1024, 1024 * 1024),
    replayWindowSeconds: positiveIntFrom(env, "CONTROL_EDGE_REPLAY_WINDOW_SECONDS", 300, 30, 900),
    workerEnabled: /^(1|true|yes)$/i.test(env.CONTROL_EDGE_WORKER_ENABLED ?? "false"),
    workerIntervalMs: positiveIntFrom(env, "CONTROL_EDGE_WORKER_INTERVAL_MS", 1000, 250, 60000),
  };
}

function requiredFileFrom(env: NodeJS.ProcessEnv, name: string, maxBytes: number): string {
  const file = env[name]?.trim();
  if (!file) throw new Error(`${name} is required; credentials must use *_FILE`);
  assertNoSymlinkComponents(file, name);
  const stat = lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile() || stat.size < 1 || stat.size > maxBytes) throw new Error(`${name} must point to a regular bounded file`);
  if (process.platform !== "win32") {
    if ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) throw new Error(`${name} must be owner-readable only`);
    const parent = lstatSync(dirname(resolve(file)));
    if ((parent.mode & 0o077) !== 0) throw new Error(`${name} parent directory is too permissive`);
  }
  return readFileSync(file, "utf8").trim();
}

function assertNoSymlinkComponents(file: string, name: string): void {
  const absolute = resolve(file);
  const root = parse(absolute).root;
  let current = root;
  for (const component of absolute.slice(root.length).split(/[\\/]+/).filter(Boolean)) {
    current = join(current, component);
    if (lstatSync(current).isSymbolicLink()) throw new Error(`${name} path contains a symlink component`);
  }
}

function positiveIntFrom(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const value = Number(env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} is invalid`);
  return value;
}
