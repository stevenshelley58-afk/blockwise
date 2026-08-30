import type { MetaCopy } from "./use-editor-state";

export type AiCopyProposal = {
  onImage: Record<string, string>;
  copy: MetaCopy;
  source: string;
};

export type AiCopySelectionKey =
  | `onImage:${string}`
  | `meta:${keyof MetaCopy}`;

export type SelectedAiCopyPayload = {
  onImage: Record<string, string>;
  copy: Partial<MetaCopy>;
};

export const META_COPY_FIELDS = [
  "primaryText",
  "headline",
  "description",
  "cta",
] as const satisfies readonly (keyof MetaCopy)[];

export function onImageCopySelectionKey(inputKey: string): AiCopySelectionKey {
  return `onImage:${inputKey}`;
}

export function metaCopySelectionKey(field: keyof MetaCopy): AiCopySelectionKey {
  return `meta:${field}`;
}

/**
 * Return every selectable field in stable UI order. The declared input order
 * wins, with any valid server-returned extras appended for defensive display.
 */
export function aiCopyProposalSelectionKeys(
  proposal: AiCopyProposal,
  declaredOnImageKeys: readonly string[] = [],
): AiCopySelectionKey[] {
  const proposalKeys = new Set(Object.keys(proposal.onImage));
  const orderedOnImageKeys = [
    ...declaredOnImageKeys.filter(key => proposalKeys.delete(key)),
    ...proposalKeys,
  ];
  return [
    ...orderedOnImageKeys.map(onImageCopySelectionKey),
    ...META_COPY_FIELDS.map(metaCopySelectionKey),
  ];
}

/**
 * Build the partial result applied by the editor in one undoable state update.
 * Selection is matched against namespaced keys rather than field names so an
 * on-image `headline` can never collide with Meta's `headline`.
 */
export function selectedAiCopyPayload(
  proposal: AiCopyProposal,
  selectedKeys: Iterable<AiCopySelectionKey>,
): SelectedAiCopyPayload {
  const selected = new Set(selectedKeys);
  const onImage = Object.fromEntries(
    Object.entries(proposal.onImage).filter(([inputKey]) =>
      selected.has(onImageCopySelectionKey(inputKey)),
    ),
  );
  const copy: Partial<MetaCopy> = {};
  for (const field of META_COPY_FIELDS) {
    if (selected.has(metaCopySelectionKey(field))) copy[field] = proposal.copy[field];
  }
  return { onImage, copy };
}
