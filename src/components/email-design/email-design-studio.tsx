"use client";

import { useEffect, useMemo, useState } from "react";

import { BlockwiseLogo } from "@/components/blockwise-logo";
import { Button } from "@/components/ui/button";
import { EMAIL_FIXTURES, EMAIL_KIND_LABELS, EMAIL_KINDS, type EmailKind } from "@/lib/email-design/fixtures";
import { EMAIL_DESIGNS, EMAIL_DESIGN_LABELS, renderEmail, type EmailColorMode, type EmailDesign } from "@/lib/email-design/renderer";

type Device = "desktop" | "mobile";

function PreviewFrame({ design, kind, theme, device, compact = false }: { design: EmailDesign; kind: EmailKind; theme: EmailColorMode; device: Device; compact?: boolean }) {
  const srcDoc = useMemo(() => renderEmail(EMAIL_FIXTURES[kind], design, theme).html, [design, kind, theme]);
  const width = device === "mobile" ? "320px" : "100%";
  return (
    <div className="overflow-hidden rounded-[16px] border border-border bg-white shadow-card" style={{ width: compact ? "100%" : device === "mobile" ? 320 : 632, maxWidth: "100%", height: frameHeight }}>
      <iframe
        title={`${EMAIL_DESIGN_LABELS[design].name}: ${EMAIL_KIND_LABELS[kind]}`}
        sandbox=""
        srcDoc={srcDoc}
        className="block border-0 bg-white"
        style={{ width: "100%", height: 820 }}
      />
    </div>
  );
}

export function EmailDesignStudio() {
  const [design, setDesign] = useState<EmailDesign>("quiet-card");
  const [kind, setKind] = useState<EmailKind>("sign-in");
  const [theme, setTheme] = useState<EmailColorMode>("light");
  const [device, setDevice] = useState<Device>("desktop");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedDesign = params.get("option");
    const requestedKind = params.get("message");
    const requestedTheme = params.get("theme");
    const requestedDevice = params.get("device");
    if (EMAIL_DESIGNS.includes(requestedDesign as EmailDesign)) setDesign(requestedDesign as EmailDesign);
    if (EMAIL_KINDS.includes(requestedKind as EmailKind)) setKind(requestedKind as EmailKind);
    if (requestedTheme === "light" || requestedTheme === "dark") setTheme(requestedTheme);
    if (requestedDevice === "desktop" || requestedDevice === "mobile") setDevice(requestedDevice);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams({ option: design, message: kind, theme, device });
    window.history.replaceState(null, "", `?${params.toString()}`);
  }, [design, kind, theme, device]);

  const selected = EMAIL_DESIGN_LABELS[design];
  return (
    <main className="tw min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1280px] px-4 py-5 sm:px-7 sm:py-8">
        <header className="flex flex-col gap-5 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-[680px]">
            <BlockwiseLogo tokens className="text-foreground" />
            <p className="mt-7 font-mono text-[10px] font-semibold tracking-[.13em] text-muted-foreground">EMAIL SYSTEM EXPLORATION · 07 SEPTEMBER 2026</p>
            <h1 className="mt-3 font-(family-name:--font-display) text-[28px] font-extrabold leading-[1.1] tracking-[-.03em] sm:text-[38px]">Three calm ways to say the same useful thing.</h1>
            <p className="mt-3 max-w-[620px] text-[14px] leading-6 text-muted-foreground">One reusable, table-based email renderer. System font fallbacks only, zero remote assets, and no decorative colour.</p>
          </div>
          <div className="rounded-[16px] border border-border bg-card px-4 py-3 text-[12px] leading-5 text-muted-foreground">
            <span className="font-semibold text-foreground">Preview note.</span> Sample actions are sandboxed.<br />Native dark mode is shown; some clients may auto-invert differently.
          </div>
        </header>

        <section aria-label="Design options" className="mt-6 grid gap-3 lg:grid-cols-3">
          {EMAIL_DESIGNS.map((item) => {
            const option = EMAIL_DESIGN_LABELS[item];
            const active = item === design;
            return (
              <button key={item} type="button" aria-pressed={active} onClick={() => setDesign(item)}
                className={`cursor-pointer rounded-[20px] border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${active ? "border-foreground bg-card shadow-card" : "border-border bg-background hover:bg-card"}`}>
                <span className="font-mono text-[10px] font-semibold tracking-[.13em] text-muted-foreground">{option.number}{item === "quiet-card" ? " · RECOMMENDED" : ""}</span>
                <span className="mt-2 block text-[16px] font-extrabold tracking-[-.015em]">{option.name}</span>
                <span className="mt-1 block text-[13px] leading-5 text-muted-foreground">{option.description}</span>
              </button>
            );
          })}
        </section>

        <section className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 rounded-[20px] border border-border bg-card p-3 shadow-card sm:p-5">
            <div className="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-mono text-[10px] font-semibold tracking-[.13em] text-muted-foreground">{selected.number} · {selected.name.toUpperCase()}</p>
                <h2 className="mt-1 text-[17px] font-extrabold tracking-[-.015em]">{EMAIL_KIND_LABELS[kind]}</h2>
              </div>
              <div className="flex flex-wrap gap-2" aria-label="Preview settings">
                <div className="inline-flex rounded-full border border-border bg-background p-0.5">
                  {(["desktop", "mobile"] as const).map((value) => <Button key={value} type="button" size="xs" variant={device === value ? "default" : "ghost"} aria-pressed={device === value} onClick={() => setDevice(value)}>{value}</Button>)}
                </div>
                <div className="inline-flex rounded-full border border-border bg-background p-0.5">
                  {(["light", "dark"] as const).map((value) => <Button key={value} type="button" size="xs" variant={theme === value ? "default" : "ghost"} aria-pressed={theme === value} onClick={() => setTheme(value)}>{value}</Button>)}
                </div>
              </div>
            </div>
            <div className={`mt-5 flex justify-center rounded-[16px] p-2 ${theme === "dark" ? "bg-[#121418]" : "bg-[#f6f7f9]"}`}>
              <PreviewFrame design={design} kind={kind} theme={theme} device={device} />
            </div>
          </div>

          <aside className="space-y-4">
            <div className="rounded-[20px] border border-border bg-card p-4">
              <p className="font-mono text-[10px] font-semibold tracking-[.13em] text-muted-foreground">MESSAGE TYPE</p>
              <div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-1">
                {EMAIL_KINDS.map((item) => <Button key={item} type="button" variant={kind === item ? "secondary" : "ghost"} size="sm" aria-pressed={kind === item} onClick={() => setKind(item)} className="justify-start px-3">{EMAIL_KIND_LABELS[item]}</Button>)}
              </div>
            </div>
            <div className="rounded-[20px] border border-border bg-background p-4">
              <p className="font-mono text-[10px] font-semibold tracking-[.13em] text-muted-foreground">READOUT</p>
              <p className="mt-2 text-[13px] leading-5 text-muted-foreground"><span className="font-semibold text-foreground">{selected.name}</span> · {EMAIL_KIND_LABELS[kind]} · {device} · {theme} simulation</p>
              <p className="mt-3 text-[12px] leading-5 text-muted-foreground">Email HTML uses presentation tables, inline essentials, a hidden preheader, plaintext companion, and no scripts, images, or font downloads.</p>
            </div>
          </aside>
        </section>

        <section aria-label="All design options at a glance" className="mt-8">
          <div className="flex items-baseline justify-between">
            <h2 className="text-[17px] font-extrabold tracking-[-.015em]">At a glance</h2>
            <span className="font-mono text-[10px] tracking-[.12em] text-muted-foreground">SAME CONTENT · THREE COMPOSITIONS</span>
          </div>
          <div className="mt-3 grid gap-4 lg:grid-cols-3">
            {EMAIL_DESIGNS.map((item) => <button key={item} type="button" onClick={() => setDesign(item)} className="cursor-pointer rounded-[20px] border border-border bg-card p-3 text-left hover:shadow-card focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"><span className="mb-3 block text-[13px] font-bold">{EMAIL_DESIGN_LABELS[item].number} · {EMAIL_DESIGN_LABELS[item].name}</span><PreviewFrame design={item} kind={kind} theme={theme} device="mobile" /></button>)}
          </div>
        </section>
      </div>
    </main>
  );
}
