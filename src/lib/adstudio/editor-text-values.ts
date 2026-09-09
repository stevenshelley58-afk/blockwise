export type EditorTextValueInput = {
  key: string;
  placeholder: string;
};

/**
 * Saved documents contain customer overrides, not duplicate template copy.
 * Rehydrate omitted values from the authored template so the inspector and
 * rendered preview show the same content after a reload.
 */
export function hydrateSavedEditorTextValues(
  inputs: readonly EditorTextValueInput[],
  savedValues: Readonly<Record<string, string>>,
  authoredValues: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return Object.fromEntries(inputs.map((input) => {
    const saved = savedValues[input.key];
    if (typeof saved === "string" && saved.trim().length > 0) return [input.key, saved];
    const authored = authoredValues[input.key];
    return [
      input.key,
      typeof authored === "string" && authored.trim().length > 0
        ? authored
        : input.placeholder,
    ];
  }));
}
