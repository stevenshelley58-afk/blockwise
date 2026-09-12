import type { Metadata } from "next";

import { WorkflowMotionStudy } from "@/components/motion-study/workflow-motion-study";

import "@/components/motion-study/workflow-motion-study.css";

export const metadata: Metadata = {
  title: "Ad Studio Motion Study",
  description: "A private motion study for the Ad Studio workflow.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-static";

export default function MotionStudyPage() {
  return <WorkflowMotionStudy />;
}
