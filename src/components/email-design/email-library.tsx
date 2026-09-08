"use client";
import { useEffect, useMemo, useState } from "react";
import { BlockwiseLogo } from "@/components/blockwise-logo";
import { Button } from "@/components/ui/button";
import { EMAIL_CATEGORIES, EMAIL_TEMPLATES, NOTIFICATION_TEMPLATE_IDS, getTemplate, requiredVariables } from "@/lib/email-design/catalog";
import { renderExample, exampleStates, EXAMPLE_STATE_LABELS, type ExampleState } from "@/lib/email-design/examples";
import type { EmailColorMode } from "@/lib/email-design/renderer";
import { EmailPreviewFrame } from "./email-preview-frame";

const FRANK_LIBRARY = "https://frank.fail/api/chat/uploads/library/blockwise-email/2026-09-08-v1.1/blockwise-email-library.zip?download=1";
const fieldStyle = "mt-2 min-h-11 w-full min-w-0 rounded-xl border border-border bg-card px-3 text-[13px] text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50";
const deliveryLabel = { transactional: "Service email", "optional-service": "Optional notification", marketing: "Subscriber email" };

export function EmailLibrary({ notificationsOnly = false }: { notificationsOnly?: boolean }) {
  const [id, setId] = useState(notificationsOnly ? "daily-digest" : "weekly-newsletter");
  const [requestedState, setRequestedState] = useState<ExampleState>("standard");
  const state = exampleStates(id).includes(requestedState) ? requestedState : "standard";
  const [theme, setTheme] = useState<EmailColorMode>("light");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedId = params.get("template");
    const requestedTheme = params.get("theme");
    if ((notificationsOnly ? NOTIFICATION_TEMPLATE_IDS : EMAIL_TEMPLATES.map(item => item.id)).some(id => id === requestedId)) setId(requestedId!);
    if (requestedTheme === "light" || requestedTheme === "dark" || requestedTheme === "system") setTheme(requestedTheme);
    if (params.get("device") === "mobile") setDevice("mobile");
    const requestedState = params.get("state");
    if (requestedState === "quiet" || requestedState === "delayed") setRequestedState(requestedState);
    setReady(true);
  }, [notificationsOnly]);
  useEffect(() => {
    if (ready) window.history.replaceState(null, "", `?${new URLSearchParams({ template: id, theme, device, state })}`);
  }, [id, theme, device, state, ready]);
  const template = getTemplate(id);
  const rendered = useMemo(() => renderExample(id, theme, state), [id, theme, state]);
  const adaptive = useMemo(() => renderExample(id, "system", state), [id, state]);
  const fields = requiredVariables(id);
  function downloadSample(format: "html" | "txt") {
    const blob = new Blob([format === "html" ? adaptive.html : adaptive.text], { type: format === "html" ? "text/html;charset=utf-8" : "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `blockwise-${id}-${state}-SAMPLE.${format}`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <main className="tw min-h-screen bg-background text-foreground">
    <div className="mx-auto max-w-[1320px] px-4 py-6 sm:px-7 sm:py-9">
      <header className="flex flex-col justify-between gap-6 border-b border-border pb-7 lg:flex-row lg:items-end">
        <div className="max-w-[680px]">
          <BlockwiseLogo tokens className="text-foreground" />
          <p className="mt-7 font-mono text-[10px] font-semibold tracking-[.13em] text-muted-foreground">{notificationsOnly ? "QUIET CARD · ACTIVITY EMAILS" : "QUIET CARD · APPROVED EMAIL SYSTEM"}</p>
          <h1 className="mt-3 font-(family-name:--font-display) text-[30px] font-extrabold leading-[1.1] tracking-[-.03em] sm:text-[40px]">{notificationsOnly ? "Daily. Weekly. A new lead." : "Every email. One familiar feel."}</h1>
          {!notificationsOnly && <a href="/email-preview/email-notifications" className="mt-4 inline-flex min-h-11 items-center text-[14px] font-semibold underline">View the three activity emails →</a>}
        </div>
        <a href={FRANK_LIBRARY} className="inline-flex min-h-11 w-fit items-center justify-center rounded-full bg-primary px-5 py-3 text-[13px] font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">Get the library from Frank ↗</a>
      </header>

      <div className="mt-6 grid items-start gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="min-w-0 space-y-4">
          <section className="rounded-[20px] border border-border bg-card p-4">
            <h2 className="font-mono text-[10px] font-semibold tracking-[.13em] text-muted-foreground">CHOOSE A TEMPLATE</h2>
            {notificationsOnly ? <div className="mt-3 space-y-2">
              {NOTIFICATION_TEMPLATE_IDS.map((item, index) => <Button key={item} variant={item === id ? "secondary" : "ghost"} aria-pressed={item === id} onClick={() => { setId(item); setRequestedState("standard"); }} className="h-auto min-h-14 w-full justify-start gap-3 whitespace-normal px-3 text-left"><span className="font-mono text-[10px] text-muted-foreground">0{index + 1}</span>{getTemplate(item).label}</Button>)}
              <p className="pt-3 text-[12px] leading-5 text-muted-foreground">Three independent choices. Daily, weekly, new leads, or any combination.</p>
            </div> : <>
            <label className="mt-4 block text-[12px] font-semibold">Category
              <select aria-label="Template category" className={fieldStyle} value={template.category} onChange={event => setId(EMAIL_TEMPLATES.find(item => item.category === event.target.value)!.id)}>
                {EMAIL_CATEGORIES.map(category => <option key={category}>{category}</option>)}
              </select>
            </label>
            <label className="mt-4 block text-[12px] font-semibold">Email
              <select aria-label="Email template" className={fieldStyle} value={id} onChange={event => setId(event.target.value)}>
                {EMAIL_TEMPLATES.filter(item => item.category === template.category).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <div className="mt-4 hidden space-y-1 border-t border-border pt-3 lg:block" aria-label="Templates in this category">
              {EMAIL_TEMPLATES.filter(item => item.category === template.category).map(item => <Button key={item.id} variant={item.id === id ? "secondary" : "ghost"} aria-pressed={item.id === id} onClick={() => setId(item.id)} className="h-auto min-h-11 w-full justify-start whitespace-normal px-3 text-left text-[13px]">{item.label}</Button>)}
            </div>
            </>}
            {exampleStates(id).length > 1 && <label className="mt-4 block border-t border-border pt-4 text-[12px] font-semibold">Example state
              <select aria-label="Example state" className={fieldStyle} value={state} onChange={event => setRequestedState(event.target.value as ExampleState)}>{exampleStates(id).map(value => <option key={value} value={value}>{EXAMPLE_STATE_LABELS[value]}</option>)}</select>
            </label>}

          </section>
          <section className="hidden rounded-[20px] border border-border bg-background p-4 lg:block">
            <h2 className="text-[13px] font-bold">Adaptive in the inbox</h2>
            <p className="mt-2 text-[12px] leading-5 text-muted-foreground">One email contains both colour schemes. Supporting mail apps choose at opening time. Other apps may adjust colours themselves.</p>
            <p className="mt-3 text-[12px] leading-5 text-muted-foreground">No theme-tracking pixel. No images or font downloads. A complete plain-text version travels with every template.</p>
          </section>
        </aside>

        <section className="min-w-0 rounded-[20px] border border-border bg-card p-3 shadow-card sm:p-5" aria-label="Selected email preview">
          <div className="flex flex-col justify-between gap-4 border-b border-border pb-4 xl:flex-row xl:items-center">
            <div className="min-w-0">
              <p className="font-mono text-[10px] font-semibold tracking-[.12em] text-muted-foreground">{template.notificationPreference ? "OPTIONAL ACTIVITY EMAIL" : deliveryLabel[template.delivery].toUpperCase()}</p>
              <h2 className="mt-1 text-[18px] font-extrabold tracking-[-.02em]">{template.label}</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="inline-flex rounded-full border border-border bg-background p-0.5" aria-label="Preview width">
                {(["desktop", "mobile"] as const).map(value => <Button key={value} size="sm" className="min-h-11 px-3 capitalize" variant={device === value ? "default" : "ghost"} aria-pressed={device === value} onClick={() => setDevice(value)}>{value}</Button>)}
              </div>
              <div className="inline-flex rounded-full border border-border bg-background p-0.5" aria-label="Preview colour scheme">
                {(["light", "dark", "system"] as const).map(value => <Button key={value} size="sm" className="min-h-11 px-3 capitalize" variant={theme === value ? "default" : "ghost"} aria-pressed={theme === value} onClick={() => setTheme(value)}>{value}</Button>)}
              </div>
            </div>
          </div>
          <div className="py-4 text-[12px] leading-5 text-muted-foreground"><span className="font-semibold text-foreground">Subject:</span> {rendered.subject}</div>
          <div className={`flex justify-center rounded-[16px] p-1 sm:p-3 ${theme === "dark" ? "bg-[#121418]" : "bg-[#f6f7f9]"}`}>
            <EmailPreviewFrame html={rendered.html} title={`Quiet card: ${template.label}`} device={device} />
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12px] leading-5 text-muted-foreground">{(adaptive.bytes / 1024).toFixed(1)} KB HTML · Zero remote assets · Fictional sample content</p>
            <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" className="min-h-11" onClick={() => downloadSample("html")}>Sample HTML</Button><Button size="sm" variant="outline" className="min-h-11" onClick={() => downloadSample("txt")}>Plain text</Button></div>
          </div>
          <details className="mt-4 border-t border-border pt-3 text-[12px] leading-5">
            <summary className="min-h-11 cursor-pointer py-3 font-semibold">Template details &amp; required information</summary>
            <p className="text-muted-foreground"><strong className="text-foreground">Use when:</strong> {template.trigger}.</p>
            <p className="mt-2 text-muted-foreground">{template.delivery === "transactional" ? "Send only after a confirmed, relevant account event. Keep promotional content out of service emails." : "Respect the selected notification preference and recipient eligibility before delivery. Unsubscribe links turn off only this type of notification."}</p>
            <div className="mt-3 flex flex-wrap gap-2">{fields.map(field => <code key={field} className="break-all rounded-md bg-muted px-2 py-1 text-[11px]">{field}</code>)}</div>
          </details>
        </section>
      </div>
      <footer className="mt-7 border-t border-border pt-5 text-[12px] leading-5 text-muted-foreground">Template library only. Nothing is sent or scheduled here. Test the chosen templates in your actual Gmail, Apple Mail and Outlook accounts before enabling delivery; dark-mode transformations vary by client.</footer>
    </div>
  </main>;
}
