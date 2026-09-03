export function adFormatLabel(hasFeed: boolean, hasStory: boolean): "Feed" | "Story" | "Feed + Story" {
  if (hasFeed && hasStory) return "Feed + Story";
  if (hasFeed) return "Feed";
  if (hasStory) return "Story";
  return "Feed + Story";
}
