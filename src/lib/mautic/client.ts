const MAUTIC_TIMEOUT_MS = 10_000;

export type MauticSkipped = { skipped: true };

type MauticRequestContext = {
  contactId?: string;
  emailDomain?: string;
  flow?: string;
};

type MauticRequestOptions = {
  body?: Record<string, unknown>;
  context?: MauticRequestContext;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

export async function mauticRequest<T>(
  method: "GET" | "PATCH" | "POST",
  path: string,
  options: MauticRequestOptions = {},
): Promise<T | MauticSkipped> {
  const env = options.env ?? process.env;
  const baseUrl = env.MAUTIC_API_URL?.trim();
  const user = env.MAUTIC_API_USER?.trim();
  const password = env.MAUTIC_API_PASSWORD;

  if (!baseUrl || !user || !password) {
    const details = [
      options.context?.flow ? `flow=${options.context.flow}` : null,
      options.context?.contactId ? `contact_id=${options.context.contactId}` : null,
      options.context?.emailDomain ? `email_domain=${options.context.emailDomain}` : null,
    ].filter(Boolean).join(" ");
    console.info(`[mautic] skipped${details ? ` ${details}` : ""}: API configuration is incomplete`);
    return { skipped: true };
  }

  const url = new URL(path, `${baseUrl.replace(/\/+$/u, "")}/`);
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(MAUTIC_TIMEOUT_MS)])
    : AbortSignal.timeout(MAUTIC_TIMEOUT_MS);
  const response = await (options.fetchImpl ?? fetch)(url, {
    method,
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
    signal,
  });

  if (!response.ok) {
    throw new Error(`Mautic ${method} failed with status ${response.status}.`);
  }

  return (await response.json()) as T;
}

export function isMauticSkipped(value: unknown): value is MauticSkipped {
  return Boolean(value && typeof value === "object" && (value as MauticSkipped).skipped === true);
}
