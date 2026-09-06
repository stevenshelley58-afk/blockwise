export type MockTrialResult = {
  ok: true;
  email: string;
  message: string;
};

export function validateTrialEmail(value: string): string | null {
  const email = value.trim();
  if (!email) return "Enter your work email.";
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Enter a valid email address.";
  }
  return null;
}

/**
 * Mock-only integration seam for the concept preview. Replace this adapter
 * with the approved signup service if the concept moves into production.
 * It intentionally performs no network request, persistence or analytics.
 */
export async function requestMockTrial(
  value: string,
  options: { delayMs?: number } = {},
): Promise<MockTrialResult> {
  const validationError = validateTrialEmail(value);
  if (validationError) throw new Error(validationError);

  await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 650));

  return {
    ok: true,
    email: value.trim().toLowerCase(),
    message: "Demo complete — your email was not sent or saved.",
  };
}
