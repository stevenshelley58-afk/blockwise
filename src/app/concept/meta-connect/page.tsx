import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { MetaConnectPreview } from "@/components/meta/meta-connect-preview";
import { getMetaPartnerBusinessId } from "@/lib/providers/meta-partner";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Connect Meta preview | Blockwise",
  description: "A synthetic preview of the Blockwise Meta connection flow.",
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

export default function MetaConnectPreviewPage() {
  if (process.env.BLOCKWISE_META_CONNECT_PREVIEW !== "true") notFound();

  return <MetaConnectPreview businessId={getMetaPartnerBusinessId()} />;
}
