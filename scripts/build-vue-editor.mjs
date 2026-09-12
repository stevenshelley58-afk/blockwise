import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const editor = fileURLToPath(new URL('../apps/vue-ad-editor/', import.meta.url));
const destination = fileURLToPath(new URL('../public/vue-ad-editor/', import.meta.url));
const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
for (const args of [['install', '--frozen-lockfile'], ['build']]) {
  const result = spawnSync(executable, ['--yes', 'pnpm@11.21.0', ...args], {
    cwd: editor,
    stdio: 'inherit',
    env: { ...process.env, CI: 'true' },
    shell: process.platform === 'win32',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
// Only the generated editor bundle is replaced, never the legacy editor.
rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
cpSync(new URL('../apps/vue-ad-editor/dist/', import.meta.url), destination, { recursive: true });
console.log('Self-hosted Vue editor built at public/vue-ad-editor/.');
