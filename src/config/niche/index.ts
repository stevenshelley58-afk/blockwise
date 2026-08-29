import { blockwise } from "./blockwise";

export type {
  NicheConfig,
  NicheFeatures,
  NicheNavItem,
} from "./niche";

/**
 * The single white-label switch. Point this at a different niche config
 * (e.g. `dentistwise`) to re-skin the entire customer surface — no component
 * edits required.
 */
export const niche = blockwise;
