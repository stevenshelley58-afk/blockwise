# Vue Fabric Editor upstream integration

This directory vendors the browser source needed from [ikuaitu/vue-fabric-editor](https://github.com/ikuaitu/vue-fabric-editor) at commit `b3bdcfb0bd6d8f98e7483cf561ac03ba56c0d889` (21 July 2026).

The upstream project is MIT licensed. Its license is retained unchanged in [LICENSE](LICENSE).

## Deliberate integration patch

The upstream Vue 3, View UI Plus and Fabric 5 editing surface is kept familiar. Blockwise changes are isolated here:

- English is forced and the upstream cloud login, admin, template, material and upload routes are absent from the reachable module graph.
- Templates, assets and fonts come from the authenticated same-origin host through `src/bridge.ts`.
- Save, PNG/JSON export, image upload selection and AI copy assistance return to the host instead of calling upstream services.
- Feed and Story stay as separate native Fabric 5 JSON scenes.
- The iframe only accepts `blockwise.vue-editor` version 1 messages when both `event.source === window.parent` and `event.origin === window.location.origin`.
- The upstream Tapable-generated runtime hooks were replaced by the small static async hook implementation in `packages/core/AsyncSeriesHook.ts`, so the production bundle does not require CSP `unsafe-eval`.
- Native clipping is available; destructive bitmap cropping and baked image outlines are not exposed because their data-URL output bypasses the workspace media ledger.
- PSD import and canvas resizing are not exposed in the trial. The unused PSD WebAssembly dependency is removed from the shipped graph without relaxing CSP.
- Copy and preview actions live in the Blockwise header. Images use host upload/adoption, including replacing a selected photo.
- The app production base is fixed at `/vue-ad-editor/`.

No upstream environment files, dependencies or generated `dist` files are committed.

## Build

The pinned toolchain is recorded in `pnpm-lock.yaml`.

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm build
```

The optional transitive Node canvas build is explicitly disabled in `pnpm-workspace.yaml`. It is not used by the browser editor and has no Node 22 prebuilt binary. Only the required esbuild and vue-demi lifecycle scripts are allowed.
