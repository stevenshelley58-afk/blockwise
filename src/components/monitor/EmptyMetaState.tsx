import Link from "next/link";

import { niche } from "@/config/niche";

import { MetaMark } from "./MetaMonitorHeader";

export function EmptyMetaState({
  issue,
  connected,
  metaConnectHref,
}: {
  issue: string | null;
  connected: boolean;
  metaConnectHref?: string;
}) {
  const copy = niche.copy.performance.states;
  const title = connected ? (issue ?? copy.emptyTitle) : copy.disconnectedTitle;
  const body = connected ? (issue ? null : copy.emptyBody) : copy.disconnectedBody;

  return (
    <section
      aria-live="polite"
      className="grid place-items-center rounded-(--r-panel) border border-dashed border-(--line-heavy) bg-(--surface) px-6 py-16 text-center shadow-card"
    >
      <span className="grid size-[52px] place-items-center rounded-full bg-(--surface-subtle)">
        <MetaMark size={24} />
      </span>
      <h2 className="mt-4 font-display text-[17px] font-extrabold tracking-[-0.015em]">{title}</h2>
      {body ? <p className="mt-1.5 max-w-[340px] text-[13px] leading-relaxed text-muted-foreground">{body}</p> : null}
      {!connected ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
          <a
            className="inline-flex h-10 cursor-pointer items-center rounded-full bg-(--ink) px-5 text-[13px] font-bold text-white transition-[opacity,transform] duration-150 hover:opacity-85 active:scale-[0.97]"
            href={metaConnectHref ?? "/settings"}
          >
            {copy.connectCta}
          </a>
          <Link
            className="inline-flex h-10 items-center rounded-full border border-(--line-heavy) bg-(--surface) px-4 text-[13px] font-bold text-foreground transition-colors hover:bg-(--surface-subtle)"
            href="/results?example=1"
          >
            {niche.copy.performance.viewExample}
          </Link>
        </div>
      ) : null}
    </section>
  );
}
