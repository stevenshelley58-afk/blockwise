export type FabricImageLoadOptions = {
  crossOrigin: "anonymous";
};

export function getFabricImageLoadOptions(src: string, baseUrl?: string): FabricImageLoadOptions | undefined {
  const trimmed = src.trim();
  if (!trimmed || isInlineOrLocalPreview(trimmed) || trimmed.startsWith("/")) {
    return undefined;
  }

  const base = baseUrl ?? browserLocationHref();
  let url: URL;
  try {
    url = base ? new URL(trimmed, base) : new URL(trimmed);
  } catch {
    return undefined;
  }

  if (base && url.origin === new URL(base).origin) {
    return undefined;
  }

  return { crossOrigin: "anonymous" };
}

function isInlineOrLocalPreview(src: string): boolean {
  return /^(?:data|blob):/i.test(src);
}

function browserLocationHref(): string | undefined {
  return typeof window === "undefined" ? undefined : window.location.href;
}
