import type { ColourRole } from "../../../packages/ad-template-contract/src/types.ts";

// ---------------------------------------------------------------------------
// Brand Pack colour -> template colour role mapping.
//
// Shared by the customer editor (client) and the audit funnel engine (server),
// so a preview generated for an anonymous visitor uses exactly the same
// palette the workspace editor would resolve.
// ---------------------------------------------------------------------------

/** Brand Pack colour fields that map onto template colour roles. */
export interface BrandPackColours {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
}

const BRAND_PACK_ROLE_MAP: Record<keyof BrandPackColours, ColourRole> = {
  background: "background",
  primary: "primary",
  secondary: "secondary",
  accent: "accent",
  text: "mainText",
};

const HEX_COLOUR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Map a Brand Pack `colours` block onto template colour roles (partial). */
export function brandPackColoursToRoleMap(
  colours: BrandPackColours | null | undefined,
): Partial<Record<ColourRole, string>> {
  const map: Partial<Record<ColourRole, string>> = {};
  if (!colours) return map;
  for (const [field, role] of Object.entries(BRAND_PACK_ROLE_MAP) as [keyof BrandPackColours, ColourRole][]) {
    const hex = colours[field];
    if (typeof hex === "string" && HEX_COLOUR.test(hex.trim())) {
      map[role] = hex.trim();
    }
  }
  return map;
}

/**
 * Brand roles override the template palette. Roles the brand kit has no field
 * for (inverseText) keep the template value — we never invent a palette.
 */
export function resolveBrandColourMap(
  templateColours: Record<ColourRole, string>,
  brandColourMap: Partial<Record<ColourRole, string>> | null | undefined,
): Record<ColourRole, string> {
  return brandColourMap ? { ...templateColours, ...brandColourMap } : { ...templateColours };
}
