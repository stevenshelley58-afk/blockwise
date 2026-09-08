import type { CustomerMetaAdLibraryCard } from "./customer-meta-card";

export function mergeCards(previous: CustomerMetaAdLibraryCard[], incoming: CustomerMetaAdLibraryCard[]): CustomerMetaAdLibraryCard[] {
  const seen = new Set(previous.map((card) => card.id));
  const appended: CustomerMetaAdLibraryCard[] = [];
  for (const card of incoming) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    appended.push(card);
  }
  return [...previous, ...appended];
}
