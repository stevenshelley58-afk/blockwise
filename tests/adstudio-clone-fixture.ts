import {
  approveAdStudioBrandKitForUse,
  buildCloneCampaignPack,
  extractBrandKitFromWebsite,
  type AdStudioCampaignPack,
} from "../src/lib/adstudio/index.ts";

export function buildCloneTestPack(workspaceId = "workspace_clone_test"): AdStudioCampaignPack {
  const brandKit = approveAdStudioBrandKitForUse(extractBrandKitFromWebsite({
    workspaceId,
    websiteUrl: "https://northstar.example",
    marketCountry: "AU",
    htmlByUrl: {
      "https://northstar.example": "<html><head><title>Northstar Realty</title></head><body><a href='/privacy'>Privacy</a></body></html>",
    },
  }));

  return buildCloneCampaignPack({
    workspaceId,
    brandKit,
    suburb: "Scarborough",
    city: "Perth",
    state: "WA",
    firstAd: {
      source: "gallery",
      templateId: "meta-feed-020",
      description: "Clone the selected sample with the supplied property photo and agency logo.",
      imageDataUrl: "data:image/png;base64,cHJvcGVydHk=",
      templateCloneImagesByFormat: {
        "4:5": "data:image/png;base64,ZmVlZA==",
        "9:16": "data:image/png;base64,c3Rvcnk=",
      },
      formats: ["9:16", "4:5"],
    },
  });
}
