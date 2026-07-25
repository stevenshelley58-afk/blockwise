/** Shared asset-role taxonomy for the Ad Studio media library.
 *
 *  Both the workbench "Replace image" panel and the standalone Library page
 *  group assets into these four roles so the filter chips stay consistent.
 */

/** What an asset depicts — drives the library filters. */
export type AssetRole = "property" | "person" | "logo" | "background";

/** Loosely-typed asset so callers can pass demo assets (role-tagged) and live
 *  workspace/brand-kit assets (which carry no explicit role yet). */
export type MediaAsset = {
  src: string;
  label: string;
  type?: string;
  ratio?: string;
  role?: string;
};

export const ROLE_ORDER: AssetRole[] = ["property", "person", "logo", "background"];

export const ROLE_META: Record<AssetRole, { label: string; plural: string }> = {
  property: { label: "Property", plural: "Property" },
  person: { label: "Person", plural: "People" },
  logo: { label: "Logo", plural: "Logos" },
  background: { label: "Background", plural: "Backgrounds" },
};

/** Resolve a display role from an explicit tag, falling back to label/type cues
 *  so live workspace assets (agent headshots, office shots, logos) still group. */
export function resolveRole(asset: MediaAsset): AssetRole {
  if (asset.role && asset.role in ROLE_META) return asset.role as AssetRole;
  const hay = `${asset.label ?? ""} ${asset.type ?? ""}`.toLowerCase();
  if (/agent|headshot|portrait|profile|person|team/.test(hay)) return "person";
  if (/logo|wordmark|brandmark/.test(hay)) return "logo";
  if (/office|skyline|interior|living|backdrop|background|market view/.test(hay)) return "background";
  return "property";
}
