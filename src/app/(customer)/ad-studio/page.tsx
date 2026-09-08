import { HomeCommand } from "@/components/adstudio/home-command";
import { loadAdStudioLibraryPage, type LibraryAdModel } from "@/lib/adstudio/library-read-model";
import { requirePageSurfaceAccess } from "@/lib/auth/page-guards";

export const dynamic = "force-dynamic";

export default async function AdStudioPage() {
  const { supabase, access, auth } = await requirePageSurfaceAccess("adstudio");
  const timeZone = resolveTimeZone(auth.claims?.user_metadata?.timezone, access.region);
  const dateLocale = access.region === "US" ? "en-US" : "en-AU";
  let ads: LibraryAdModel[] = [];
  let adsError = false;

  try {
    const result = await loadAdStudioLibraryPage({ supabase, workspaceId: access.workspaceId, kind: "ads", limit: 3 });
    ads = result.items as LibraryAdModel[];
  } catch {
    adsError = true;
  }

  return (
    <div className="mx-auto w-full max-w-[1120px] px-4 pt-6 pb-28 md:px-6 md:pt-8 md:pb-16">
      <HomeCommand ads={ads} adsError={adsError} timeZone={timeZone} dateLocale={dateLocale} />
    </div>
  );
}

function resolveTimeZone(value: unknown, region: string | undefined): string {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (candidate) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: candidate }).format();
      return candidate;
    } catch {
      // Use the region default.
    }
  }
  return region === "US" ? "America/New_York" : "Australia/Sydney";
}