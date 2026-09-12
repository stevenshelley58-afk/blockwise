import { toPublicSupabaseUrl } from "../supabase/credentials.ts";

export const ADSTUDIO_MEDIA_URL_LIMIT = 100;
export const ADSTUDIO_MEDIA_URL_TTL_SECONDS = 60 * 60;

export type AdStudioMediaProfiles = {
  path: string;
  grid: string;
  preview: string;
  full: string;
  expiresAt: string;
};

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

export async function createAdStudioMediaUrls(input: {
  supabase: StorageClient;
  workspaceId: string;
  paths: string[];
  now?: Date;
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
      // The server client signs through the internal router, but these URLs are
      // consumed by the browser, so hand back the public origin.
      return [
        path,
        {
          path,
          grid: toPublicSupabaseUrl(grid.data.signedUrl),
          preview: toPublicSupabaseUrl(preview.data.signedUrl),
          full: toPublicSupabaseUrl(full.data.signedUrl),
          expiresAt,
        },
      ] as const;
    }),
  );
  return Object.fromEntries(entries);
}
