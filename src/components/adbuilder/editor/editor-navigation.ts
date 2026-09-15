export type EditorNavigationIntent = {
  href: string;
  currentHref: string;
  button: number;
  defaultPrevented: boolean;
  modified: boolean;
  target: string;
  download: boolean;
};

/**
 * Returns an internal route that needs the unsaved-work confirmation, or null
 * when the browser/Next Link should retain its normal behaviour.
 */
export function guardedEditorNavigationHref(intent: EditorNavigationIntent): string | null {
  if (intent.defaultPrevented || intent.button !== 0 || intent.modified || Boolean(intent.target && intent.target !== "_self") || intent.download) return null;
  const destination = new URL(intent.href);
  const current = new URL(intent.currentHref);
  if (destination.origin !== current.origin) return null;
  if (destination.pathname === current.pathname && destination.search === current.search) return null;
  return `${destination.pathname}${destination.search}${destination.hash}`;
}
