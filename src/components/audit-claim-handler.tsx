"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const AUDIT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Picks up an audit claim after signup: a visitor who generated audit ads and
 * then signed up lands on /self-serve?auditId=... — this saves those three
 * previews into their new workspace and sends them to Ad Studio.
 */
export function AuditClaimHandler({ workspaceId }: { workspaceId: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const started = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const auditId = (params.get("auditId") ?? "").trim();
    if (!AUDIT_ID.test(auditId) || started.current === `${workspaceId}:${auditId}`) return;
    started.current = `${workspaceId}:${auditId}`;

    fetch(`/api/audit/ads/claim?workspaceId=${encodeURIComponent(workspaceId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auditId }),
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as { adIds?: unknown };
        if (!response.ok || !Array.isArray(data.adIds) || data.adIds.length === 0) throw new Error("claim failed");
        router.replace("/ad-studio");
      })
      .catch(() => setFailed(true));
  }, [params, router, workspaceId]);

  if (!failed) return null;
  return (
    <div role="alert" style={{ margin: "12px 0", padding: "12px 16px", borderRadius: 12, background: "#fdf0ef", color: "#7c241f", fontSize: 14 }}>
      We could not move your 3 audit ads into Ad Studio. Your trial is ready — open Ad Studio and try the audit
      link again, or <a href="/ad-studio">continue to Ad Studio</a>.
    </div>
  );
}
