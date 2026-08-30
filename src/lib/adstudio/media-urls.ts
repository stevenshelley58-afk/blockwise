export const ADSTUDIO_MEDIA_URL_LIMIT = 100;
export const ADSTUDIO_MEDIA_URL_TTL_SECONDS = 60 * 60;

export type AdStudioMediaProfiles = {
  path: string;
  grid: string;
  preview: string;
  full: string;
  expiresAt: string;
};

export type AdStudioMediaUrlEnv = Readonly<Record<string, string | undefined>>;

const SIGNED_STORAGE_PATH_PREFIXES = [
  "/storage/v1/object/sign/workspace-artifacts/",
  "/storage/v1/render/image/sign/workspace-artifacts/",
] as const;

type StorageClient = {
  storage: {
    from: (bucket: string) => {
      createSignedUrl: (
        path: string,
        expiresIn: number,
        options?: {
          transform?: {
            width?: number;
            quality?: number;
            resize?: "cover" | "contain" | "fill";
          };
        },
      ) => Promise<{ data: { signedUrl?: string } | null; error: { message: string } | null }>;
    };
  };
};

export function isWorkspaceMediaPath(workspaceId: string, path: string): boolean {
  return Boolean(
    workspaceId &&
      path &&
      path.startsWith(`${workspaceId}/`) &&
      !path.includes("..") &&
      !path.includes("\\") &&
      !path.includes("\0"),
  );
}

/**
 * Server-side Storage clients sign against the private product-network Caddy
 * origin. Never expose that Docker hostname to a browser. Only the configured
 * private origin may be rewritten to the configured public origin; already
 * public and same-origin relative signed URLs are preserved, and any foreign
 * absolute host fails closed.
 */
export function customerReachableStorageUrl(
  signedUrl: string,
  env: AdStudioMediaUrlEnv = process.env,
): string {
  const value = signedUrl.trim();
  if (!value) throw new Error("A media URL could not be signed.");

  const publicOrigin = parseConfiguredOrigin(env.NEXT_PUBLIC_SUPABASE_URL, "NEXT_PUBLIC_SUPABASE_URL");
  const internalOrigin = parseConfiguredOrigin(
    env.BLOCKWISE_SUPABASE_INTERNAL_URL,
    "BLOCKWISE_SUPABASE_INTERNAL_URL",
  );
  const relative = value.startsWith("/") && !value.startsWith("//");
  let url: URL;
  try {
    url = new URL(value, publicOrigin ?? "https://same-origin.invalid");
  } catch {
    throw new Error("Storage returned an invalid signed media URL.");
  }

  if (!SIGNED_STORAGE_PATH_PREFIXES.some((prefix) => url.pathname.startsWith(prefix)) || url.hash) {
    throw new Error("Storage returned an invalid signed media URL.");
  }
  if (relative) return `${url.pathname}${url.search}`;
  if (!/^https?:$/u.test(url.protocol) || url.username || url.password) {
    throw new Error("Storage returned an invalid signed media URL.");
  }
  if (publicOrigin && url.origin === publicOrigin) return url.toString();
  if (internalOrigin && url.origin === internalOrigin) {
    if (!publicOrigin) throw new Error("NEXT_PUBLIC_SUPABASE_URL is required for signed media URLs.");
    return `${publicOrigin}${url.pathname}${url.search}`;
  }
  throw new Error("Storage returned a signed media URL for an untrusted host.");
}

export async function createAdStudioMediaUrls(input: {
  supabase: StorageClient;
  workspaceId: string;
  paths: string[];
  now?: Date;
  urlEnv?: AdStudioMediaUrlEnv;
}): Promise<Record<string, AdStudioMediaProfiles>> {
  const paths = [...new Set(input.paths.map((path) => path.trim()))];
  if (paths.length > ADSTUDIO_MEDIA_URL_LIMIT) {
    throw new Error(`At most ${ADSTUDIO_MEDIA_URL_LIMIT} media paths can be signed at once.`);
  }
  if (paths.some((path) => !isWorkspaceMediaPath(input.workspaceId, path))) {
    throw new Error("One or more media paths are outside this workspace.");
  }

  const bucket = input.supabase.storage.from("workspace-artifacts");
  const expiresAt = new Date(
    (input.now ?? new Date()).getTime() + ADSTUDIO_MEDIA_URL_TTL_SECONDS * 1000,
  ).toISOString();
  const entries = await Promise.all(
    paths.map(async (path) => {
      const [grid, preview, full] = await Promise.all([
        bucket.createSignedUrl(path, ADSTUDIO_MEDIA_URL_TTL_SECONDS, {
          transform: { width: 640, quality: 70, resize: "contain" },
        }),
        bucket.createSignedUrl(path, ADSTUDIO_MEDIA_URL_TTL_SECONDS, {
          transform: { width: 1280, quality: 78, resize: "contain" },
        }),
        bucket.createSignedUrl(path, ADSTUDIO_MEDIA_URL_TTL_SECONDS),
      ]);
      const error = grid.error ?? preview.error ?? full.error;
      if (error || !grid.data?.signedUrl || !preview.data?.signedUrl || !full.data?.signedUrl) {
        throw new Error(error?.message ?? "A media URL could not be signed.");
      }
      return [
        path,
        {
          path,
          grid: customerReachableStorageUrl(grid.data.signedUrl, input.urlEnv),
          preview: customerReachableStorageUrl(preview.data.signedUrl, input.urlEnv),
          full: customerReachableStorageUrl(full.data.signedUrl, input.urlEnv),
          expiresAt,
        },
      ] as const;
    }),
  );
  return Object.fromEntries(entries);
}

function parseConfiguredOrigin(value: string | undefined, label: string): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error(`${label} must be a clean HTTP(S) origin.`);
  }
  if (!/^https?:$/u.test(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${label} must be a clean HTTP(S) origin.`);
  }
  return url.origin;
}
