import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

type ResearchServiceEnv = {
  RESEARCH_API_URL?: string;
  RESEARCH_API_SERVICE_KEY?: string;
  SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
};

function clean(value?: string) {
  return value?.replace(/^\uFEFF/u, "").trim().replace(/\/+$/u, "") ?? "";
}

export function createResearchServiceClient(options: {
  env?: ResearchServiceEnv;
  fetchImpl?: typeof fetch;
} = {}) {
  const env = options.env ?? process.env;
  const url = clean(env.RESEARCH_API_URL);
  const serviceKey = clean(env.RESEARCH_API_SERVICE_KEY);
  if (!url || !serviceKey) {
    throw new Error("Private research API environment is missing.");
  }
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u.test(serviceKey)) {
    throw new Error("Private research API service key must be a signed JWT.");
  }
  const researchHost = new URL(url).hostname.toLowerCase();
  if (
    researchHost.endsWith(".supabase.co") ||
    [env.SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_URL].some((candidate) => clean(candidate) === url)
  ) {
    throw new Error("Private research API cannot point at customer Supabase.");
  }

  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      ...(options.fetchImpl ? { fetch: options.fetchImpl } : {}),
    },
    realtime: {
      transport: WebSocket as unknown as typeof globalThis.WebSocket,
    },
  });
}

export function tryCreateResearchServiceClient(options: {
  env?: ResearchServiceEnv;
  fetchImpl?: typeof fetch;
} = {}) {
  try {
    return createResearchServiceClient(options);
  } catch {
    return null;
  }
}
