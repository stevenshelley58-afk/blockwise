"use client";

import { ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Customer-facing manual Meta publishing handoff. This is not an API connection. */
export function ConnectMetaGuide({ workspaceId: _workspaceId, canManage: _canManage }: { workspaceId: string; canManage: boolean }) {
  return (
    <div className="grid gap-4">
      <section className="rounded-(--r-panel) border border-(--line) bg-(--surface) p-5 shadow-card sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-(--accent-tint)"><ShieldCheck size={19} aria-hidden /></span>
          <div>
            <p className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-(--faint) uppercase">Meta publishing</p>
            <h2 className="mt-1 font-display text-[19px] font-extrabold tracking-[-0.015em]">Choose how you want to proceed</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">Meta has not approved Blockwise&apos;s full publishing access yet. You can still get your ads published by an authorised Blockwise operator while the normal app review continues.</p>
          </div>
        </div>
        <Button className="mt-5 min-h-11" asChild><a href="/ad-studio/ads">Go to Ad Studio</a></Button>
      </section>
      <section className="rounded-(--r-panel) border border-(--line) bg-(--surface) p-5 shadow-card sm:p-6">
        <h2 className="font-display text-[17px] font-extrabold tracking-[-0.015em]">What happens next?</h2>
        <ol className="mt-3 grid gap-2 text-[13px] text-muted-foreground">
          <li><span className="font-semibold text-foreground">1. Save</span> your finished ad in Ad Studio.</li>
          <li><span className="font-semibold text-foreground">2. Review and download</span> the Feed and Story files if you need them.</li>
          <li><span className="font-semibold text-foreground">3. Request publishing.</span> An authorised Blockwise operator will publish it manually in Meta.</li>
        </ol>
      </section>
    </div>
  );
}
