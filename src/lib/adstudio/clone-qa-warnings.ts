import type { AdStudioCloneQa } from "./types.ts";

function labelForCopyCheckKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

export function cloneQaWarnings(qa: Pick<AdStudioCloneQa, "copyChecks"> | null | undefined): string[] {
  return (qa?.copyChecks ?? [])
    .filter((check) => !check.exact)
    .map((check) => {
      const rendered = check.rendered.trim();
      if (rendered) {
        return `You typed "${check.expected}" - the ad shows "${rendered}". Click the text on the ad to change it.`;
      }
      return `"${labelForCopyCheckKey(check.key)}" may be missing from the ad - check the image.`;
    });
}
