export type PropertySnapshotEntry = {
  label: string;
  value: string;
};

export function buildPropertySnapshot(normalizedFacts: Record<string, unknown>): PropertySnapshotEntry[] {
  const facts = recordValue(normalizedFacts.facts) ?? normalizedFacts;
  const address = recordValue(facts.address);
  const entries: PropertySnapshotEntry[] = [];

  const zones = zoneLabels(facts.zone ?? facts.zones);
  if (zones.length > 0) entries.push({ label: "Zones and reserves", value: zones.join(", ") });

  const rCode = codeValue(facts.r_code ?? facts.rCode);
  if (rCode) entries.push({ label: "R-code", value: rCode });

  const lotArea = areaValue(address?.lot_area_m2 ?? address?.lotAreaM2 ?? facts.lot_area_m2 ?? facts.lotAreaM2);
  if (lotArea) entries.push({ label: "Lot area", value: lotArea });

  const localGovernment = textValue(
    normalizedFacts.local_government ?? normalizedFacts.localGovernment ?? address?.local_government ?? address?.localGovernment,
  );
  if (localGovernment) entries.push({ label: "Local government", value: localGovernment });

  return entries;
}

function zoneLabels(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return Array.from(
    new Set(
      values
        .map((item) => {
          const zone = recordValue(item);
          return textValue(zone?.label ?? zone?.code ?? item);
        })
        .filter((item): item is string => Boolean(item)),
    ),
  );
}

function codeValue(value: unknown): string | null {
  const code = recordValue(value);
  return textValue(code?.code ?? code?.label ?? value);
}

function areaValue(value: unknown): string | null {
  const area = recordValue(value);
  const amount = area?.value ?? value;
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  return `${new Intl.NumberFormat("en-AU", { maximumFractionDigits: 1 }).format(amount)} m²`;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function textValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length > 0 ? text : null;
}
