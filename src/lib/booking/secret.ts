/** Resolve a booking secret from an explicit value or a protected file.
 * File-backed secrets are the production contract; the value form remains
 * available for local tests and existing non-container deployments.
 */
export function readBookingSecret(
  env: NodeJS.ProcessEnv,
  valueKey: string,
  fileKey: string,
): string {
  const direct = env[valueKey]?.trim();
  if (direct) return direct;
  const path = env[fileKey]?.trim();
  if (!path) return "";
  if (!path.startsWith("/")) throw new Error(`${fileKey} must be absolute.`);
  const getBuiltinModule = (process as typeof process & { getBuiltinModule?: (name: string) => unknown }).getBuiltinModule;
  const fs = getBuiltinModule?.("node:fs") as {
    lstatSync: (file: string) => { isFile(): boolean; isSymbolicLink(): boolean; uid?: number; mode: number };
    readFileSync: (file: string, encoding: string) => string;
  } | undefined;
  if (!fs) throw new Error("node:fs is unavailable for file-backed booking secrets.");
  const stat = fs.lstatSync(path);
  const owner = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (!stat.isFile() || stat.isSymbolicLink() || (owner !== undefined && stat.uid !== owner) || (stat.mode & 0o077) !== 0) {
    throw new Error(`${fileKey} must be an owner-readable 0600 regular file.`);
  }
  return fs.readFileSync(path, "utf8").trim();
}

export function hasBookingSecret(env: NodeJS.ProcessEnv, valueKey: string, fileKey: string): boolean {
  try {
    return Boolean(readBookingSecret(env, valueKey, fileKey));
  } catch {
    return false;
  }
}
