import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { adDocumentSchema, templatePackSchema } from "./schema.js";
import { sha256Hex, verifyManifestHash } from "./hash.js";

// Representative output from Frank's provider-neutral -> Blockwise adapter.
const pack = {
  schema:"blockwise.template-pack/v1",templateId:"pack_demo_1",version:1,packId:"pack_demo_1",createdAt:"1970-01-01T00:00:00.000Z",builderVersion:"frank/ad-template-builder-v2",rendererVersion:"frank-reference-renderer/v1",classification:{label:"portable_ad_template",modelVersion:"recorded-in-provenance",confidence:1},manifestSha256:"fe7e2587b0b5dc3ce680cbab46a8af86ada04bcc9e983c35009b67857e9de291",signature:"ed25519-signature-record",feedLayout:{placement:"feed",layers:[{type:"plate",layerId:"bg",colourRole:"background",geometry:{x:0,y:0,width:1080,height:1350},protected:false}],safeZones:[{x:40,y:40,width:1000,height:1270}]},storyLayout:{placement:"story",layers:[{type:"plate",layerId:"bg",colourRole:"background",geometry:{x:0,y:0,width:1080,height:1920},protected:false}],safeZones:[{x:40,y:200,width:1000,height:1520}]},imageInputs:[{key:"photo",label:"photo",acceptedTypes:["image/jpeg","image/png","image/webp"]}],textInputs:[{key:"headline",label:"headline",placeholder:"Your headline",maxLength:40}],semanticColours:{background:"#FFFFFF",primary:"#1A56DB",secondary:"#6B7280",accent:"#F59E0B",mainText:"#111827",inverseText:"#FFFFFF"},assets:{plate:{fileName:"plate.png",sha256:"1111111111111111111111111111111111111111111111111111111111111111",mimeType:"image/png"}},fonts:[],safePreviews:{feed:{sha256:"3333333333333333333333333333333333333333333333333333333333333333"},story:{sha256:"4444444444444444444444444444444444444444444444444444444444444444"}},qaEvidence:{feedPassed:true,storyPassed:true,reviewerVersions:["frank-studio-qa/v1"],stressFixtureResults:{portablePack:"pass"}},
} as const;

describe("Frank TemplatePack adapter conformance", () => {
  it("imports the immutable pack and verifies its canonical manifest", () => {
    assert.ok(templatePackSchema.safeParse(pack).success);
    assert.ok(verifyManifestHash(pack));
  });

  it("constructs an editable, placement-ready Blockwise ad document", () => {
    const document = {
      schema:"blockwise.ad-document/v1",templateId:pack.templateId,templateVersion:pack.version,templateHash:pack.manifestSha256,
      rendererVersion:pack.rendererVersion,sharedImageValues:{photo:"workspace-assets/property.webp"},sharedTextValues:{headline:"A new headline"},
      feedCropOverrides:{},storyCropOverrides:{},colourMode:"template",resolvedColourMap:pack.semanticColours,
      metaPrimaryText:"Primary text",metaHeadline:"A new headline",metaDescription:"Description",metaCta:"LEARN_MORE",
      revision:1,documentHash:sha256Hex({photo:"workspace-assets/property.webp",headline:"A new headline"}),lastRenderedHash:null,
    };
    assert.ok(adDocumentSchema.safeParse(document).success);
    assert.equal(pack.feedLayout.placement, "feed");
    assert.equal(pack.storyLayout.placement, "story");
  });
});
