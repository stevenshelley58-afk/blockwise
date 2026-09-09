"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export function EmailPreviewFrame({ html, title, device, compact = false }: { html: string; title: string; device: "desktop" | "mobile"; compact?: boolean }) {
  const [height, setHeight] = useState(640);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const observer = useRef<ResizeObserver | null>(null);
  const connect = useCallback(() => {
    observer.current?.disconnect();
    const body = frame.current?.contentDocument?.body;
    if (!body) return;
    const measure = () => setHeight(Math.ceil(body.getBoundingClientRect().height) + 24);
    measure(); observer.current = new ResizeObserver(measure); observer.current.observe(body);
  }, []);
  // The initial srcdoc load can finish before React hydrates and attaches onLoad.
  useEffect(() => { connect(); return () => observer.current?.disconnect(); }, [html, connect]);
  return <div className="overflow-hidden rounded-[16px] border border-border bg-white shadow-card" style={{ width: compact ? "100%" : device === "mobile" ? 320 : 632, maxWidth: "100%", minWidth: 0, height }}>
    <iframe ref={frame} title={title} sandbox="allow-same-origin" tabIndex={-1} srcDoc={html} onLoad={connect}
      className="pointer-events-none block border-0" style={{ width: "100%", minWidth: 0, maxWidth: "100%", height }} />
  </div>;
}
