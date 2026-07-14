import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, link, lstat, mkdir, open, readFile, realpath, stat, unlink } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function canonicalValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON cannot contain non-finite numbers.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((entry) => canonicalValue(entry));
  if (typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) throw new TypeError(`Canonical JSON cannot contain undefined at ${key}.`);
      result[key] = canonicalValue(value[key]);
    }
    return result;
  }
  throw new TypeError(`Canonical JSON cannot contain ${typeof value}.`);
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function sha256Canonical(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

export function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function runGit(repoRoot, args) {
  return execFileAsync("git", args, { cwd: repoRoot, encoding: "utf8", windowsHide: true });
}

function repoRelativePath(repoRoot, target) {
  const relative = path.relative(path.resolve(repoRoot), path.resolve(target));
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Evidence path must be a file inside the repository.");
  }
  return relative.split(path.sep).join("/");
}

export async function assertIgnoredOutputPath({ repoRoot, outputPath }) {
  const relative = repoRelativePath(repoRoot, outputPath);
  let tracked;
  try {
    ({ stdout: tracked } = await runGit(repoRoot, ["ls-files", "--", relative]));
  } catch {
    throw new Error("Could not prove manifest output is untracked and ignored by git.");
  }
  if (tracked.trim()) throw new Error("Manifest output must not be tracked by git.");
  try {
    await runGit(repoRoot, ["check-ignore", "--quiet", "--", relative]);
  } catch {
    throw new Error("Manifest output must be ignored by git.");
  }
}

function pathIsWithin(root, target) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

async function windowsIdentitySid() {
  const command = "[Security.Principal.WindowsIdentity]::GetCurrent().User.Value";
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
  });
  const sid = stdout.trim();
  if (!/^S-1-(?:\d+-)+\d+$/.test(sid)) throw new Error("Could not determine the current Windows security identity.");
  return sid;
}

async function verifyWindowsAcl(target, sid) {
  const command = [
    "$acl = Get-Acl -LiteralPath $env:ADSTUDIO_EVIDENCE_PATH",
    "if (-not $acl.AreAccessRulesProtected) { exit 11 }",
    "$sid = $env:ADSTUDIO_EVIDENCE_SID",
    "$allow = @($acl.Access | Where-Object { $_.AccessControlType -eq 'Allow' })",
    "if ($allow.Count -ne 1) { exit 12 }",
    "$actual = $allow[0].IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value",
    "if ($actual -ne $sid) { exit 13 }",
    "$full = [Security.AccessControl.FileSystemRights]::FullControl",
    "if (($allow[0].FileSystemRights -band $full) -ne $full) { exit 14 }",
  ].join("; ");
  await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, ADSTUDIO_EVIDENCE_PATH: target, ADSTUDIO_EVIDENCE_SID: sid },
  });
}

async function applyAndVerifyPrivatePermissions(target, { directory = false } = {}) {
  if (process.platform === "win32") {
    const sid = await windowsIdentitySid();
    const rights = directory ? "(OI)(CI)F" : "(F)";
    await execFileAsync("icacls.exe", [target, "/inheritance:r", "/grant:r", `*${sid}:${rights}`], {
      encoding: "utf8",
      windowsHide: true,
    });
    await verifyWindowsAcl(target, sid);
    return "windows-protected-acl";
  }
  const expected = directory ? 0o700 : 0o600;
  await chmod(target, expected);
  const actual = (await stat(target)).mode & 0o777;
  if (actual !== expected) {
    throw new Error(`Evidence permissions verification failed: expected ${expected.toString(8)}, received ${actual.toString(8)}.`);
  }
  return directory ? "posix-0700" : "posix-0600";
}

async function ensurePrivateDirectoryChain(repoRoot, directory) {
  const root = path.resolve(repoRoot);
  const rootReal = await realpath(root);
  const relative = path.relative(root, directory);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Manifest directory must stay inside the repository.");
  }
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await mkdir(current, { mode: 0o700 });
      info = await lstat(current);
    }
    if (info.isSymbolicLink()) throw new Error("Manifest path contains a symbolic link or junction.");
    if (!info.isDirectory()) throw new Error("Manifest directory path contains a non-directory entry.");
    const currentReal = await realpath(current);
    if (!pathIsWithin(rootReal, currentReal)) throw new Error("Manifest directory real path escaped the repository.");
    await applyAndVerifyPrivatePermissions(current, { directory: true });
  }
}

export async function writeSecureManifest({ repoRoot, outputPath, manifest }) {
  const artifactsRoot = path.resolve(repoRoot, "artifacts");
  const target = path.resolve(repoRoot, outputPath);
  if (target !== artifactsRoot && !target.startsWith(`${artifactsRoot}${path.sep}`)) {
    throw new Error("Manifest output must stay inside the repository artifacts directory.");
  }
  await assertIgnoredOutputPath({ repoRoot, outputPath: target });
  const directory = path.dirname(target);
  await ensurePrivateDirectoryChain(repoRoot, directory);
  const temporary = path.join(directory, `.${path.basename(target)}.${process.pid}.${randomUUID()}.tmp`);
  const bytes = Buffer.from(`${canonicalJson(manifest)}\n`, "utf8");
  let handle;
  let permissionsScheme;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await applyAndVerifyPrivatePermissions(temporary);
    try {
      await link(temporary, target);
    } catch (error) {
      if (error?.code === "EEXIST") throw new Error(`Manifest already exists: ${target}`);
      throw error;
    }
    permissionsScheme = await applyAndVerifyPrivatePermissions(target);
  } finally {
    if (handle) await handle.close();
    await unlink(temporary).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
  const writtenBytes = await readFile(target);
  if (!writtenBytes.equals(bytes)) throw new Error("Manifest bytes changed while being written.");
  return {
    outputPath: target,
    byteLength: writtenBytes.byteLength,
    fileSha256: sha256Bytes(writtenBytes),
    permissionsVerified: true,
    permissionsScheme,
  };
}
