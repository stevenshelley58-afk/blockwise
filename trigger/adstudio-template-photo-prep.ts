import { task } from "@trigger.dev/sdk/v3";

import {
  runAdStudioTemplatePhotoPrepJob,
  type AdStudioTemplatePhotoPrepPayload,
} from "../src/lib/adstudio/template-photo-prep-job.ts";

export const prepareAdStudioTemplatePhotoTask = task({
  id: "adstudio.template-photo-prep",
  maxDuration: 280,
  run: async (payload: AdStudioTemplatePhotoPrepPayload) => runAdStudioTemplatePhotoPrepJob(payload),
});
