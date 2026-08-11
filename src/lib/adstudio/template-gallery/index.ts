// Customer-visible templates are the exact, quality-locked release set. Draft
// and partial manifests never enter the application bundle.
import metaAgentIntroFeed037 from "./meta-agent-intro-feed-037.json" with { type: "json" };
import metaAgentIntroFeed051 from "./meta-agent-intro-feed-051.json" with { type: "json" };
import metaFeed018 from "./meta-feed-018.json" with { type: "json" };
import metaFeed020 from "./meta-feed-020.json" with { type: "json" };
import metaFeed055 from "./meta-feed-055.json" with { type: "json" };
import metaFeed151 from "./meta-feed-151.json" with { type: "json" };
import metaFeed165 from "./meta-feed-165.json" with { type: "json" };
import metaLeadChecklistStory304 from "./meta-lead-checklist-story-304.json" with { type: "json" };
import metaMarketReportFeed139 from "./meta-market-report-feed-139.json" with { type: "json" };
import metaSellerConsultFeed166 from "./meta-seller-consult-feed-166.json" with { type: "json" };
import metaStories245 from "./meta-stories-245.json" with { type: "json" };
import metaStories255 from "./meta-stories-255.json" with { type: "json" };
import type { AdStudioGalleryTemplate } from "../templates.ts";

export const RAW_ADSTUDIO_GALLERY_TEMPLATES: AdStudioGalleryTemplate[] = [
  metaAgentIntroFeed037,
  metaAgentIntroFeed051,
  metaFeed018,
  metaFeed020,
  metaFeed055,
  metaFeed151,
  metaFeed165,
  metaLeadChecklistStory304,
  metaMarketReportFeed139,
  metaSellerConsultFeed166,
  metaStories245,
  metaStories255,
] as unknown as AdStudioGalleryTemplate[];
