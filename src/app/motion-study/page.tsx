import type { Metadata } from "next";

import { WorkflowMotionStudy } from "@/components/motion-study/workflow-motion-study";


export const metadata: Metadata = {
  title: "Ad Studio Motion Study",
  description: "A private motion study for the Ad Studio workflow.",
  robots: { index: false, follow: false },
  other: { "blockwise-preview-revision": process.env.BLOCKWISE_BUILD_REVISION ?? "" },
};

export const dynamic = "force-static";

export default function MotionStudyPage() {
  return <WorkflowMotionStudy />;
}
