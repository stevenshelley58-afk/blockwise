/** Operator recipients are deliberately limited to the Blockwise mailbox domain. */
export const BLOCKWISE_EMAIL_DOMAIN = "blockwise.sale";

const OPERATOR_RECIPIENT_KEYS = [
  "ALERT_EMAIL_TO",
  "DEMO_NOTIFY_TO",
  "BLOCKWISE_OWNER_ALERT_EMAIL",
] as const;

/**
 * Resolve the first configured operator mailbox, failing closed for an empty,
 * malformed, or external address. An invalid higher-priority value must not
 * silently fall through to a different recipient.
 */
export function resolveConfiguredOperatorRecipient(
  env: Record<string, string | undefined> = process.env,
): string | null {
  for (const key of OPERATOR_RECIPIENT_KEYS) {
    const value = env[key]?.trim();
    if (!value) continue;
    return isBlockwiseSaleAddress(value) ? value : null;
  }
  return null;
}

export function isBlockwiseSaleAddress(value: string): boolean {
  return /^[^\s@,;<>]+@blockwise\.sale$/i.test(value.trim());
}
