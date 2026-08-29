// Barrel export — everything Frank and Blockwise consume.
// NOTE: relative specifiers use the `.ts` extension so Node's native type
// stripping can load this package's source directly (repo convention).
// `rewriteRelativeImportExtensions` in tsconfig rewrites them back to `.js`
// in the emitted dist, so built consumers (Frank) are unaffected.
export * from "./types.ts";
export * from "./schema.ts";
