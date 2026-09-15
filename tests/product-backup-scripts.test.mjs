import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, existsSync, rmSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
const source = readFileSync(new URL("../scripts/vps/product-backup-retention.sh", import.meta.url), "utf8");
function fixture(fn) {
  const root = mkdtempSync(join(tmpdir(), "backup-count-test-"));
  const backup = join(root, "backups"); mkdirSync(backup);
  const old = join(backup, "20260101T000000Z"); mkdirSync(old);
  const native = join(root, "native"), wrapper = join(root, "wrapper"), log = join(root, "calls");
  writeFileSync(wrapper, source.replaceAll("/srv/blockwise/product/backups/encrypted", backup).replaceAll("/usr/local/libexec/vps-backup-retention", native));
  try { fn({root, backup, old, native, wrapper, log}); } finally { rmSync(root, {recursive:true, force:true}); }
}
test("delegates fixed product series without deleting locally", () => fixture(({backup,old,native,wrapper,log}) => {
  writeFileSync(native, `#!/bin/bash\nprintf '%s\\n' "$@" > "${log}"\n`); chmodSync(native,0o700);
  execFileSync("bash",[wrapper,backup,"2"]);
  assert.equal(readFileSync(log,"utf8"),"--apply\n--series\nproduct\n"); assert.ok(existsSync(old));
}));
test("missing helper fails closed and preserves backups", () => fixture(({backup,old,wrapper}) => {
  assert.notEqual(spawnSync("bash",[wrapper,backup,"2"]).status,0); assert.ok(existsSync(old));
}));
test("helper verification failure propagates without a fallback", () => fixture(({backup,old,native,wrapper}) => {
  writeFileSync(native,"#!/bin/bash\nexit 41\n"); chmodSync(native,0o700);
  assert.equal(spawnSync("bash",[wrapper,backup,"2"]).status,41); assert.ok(existsSync(old));
}));
test("rejects old age interface and wrong root", () => fixture(({backup,wrapper}) => {
  assert.notEqual(spawnSync("bash",[wrapper,backup,"90"]).status,0);
  assert.notEqual(spawnSync("bash",[wrapper,"/tmp","2"]).status,0);
}));
test("backup verification precedes retention and metadata is count-based", () => {
  const s=readFileSync(new URL("../scripts/vps/product-encrypted-backup.sh",import.meta.url),"utf8");
  assert.ok(s.indexOf('"$SCRIPT_DIR/product-backup-verify.sh" "$final"') < s.indexOf('"$SCRIPT_DIR/product-backup-retention.sh" "$BACKUP_ROOT"'));
  assert.match(s,/retention_count=%s/); assert.doesNotMatch(s,/RETENTION_DAYS|retention_days/);
  assert.doesNotMatch(source,/-mtime|rm -rf|find /);
  const install=readFileSync(new URL("../scripts/vps/install-product-backup-timer.sh",import.meta.url),"utf8");
  assert.ok(install.indexOf('[[ -x /usr/local/libexec/vps-backup-retention ]]') < install.indexOf('systemctl enable'));
});
