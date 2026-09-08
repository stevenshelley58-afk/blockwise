import Link from "next/link";
import type { ReactNode } from "react";

import { BlockwiseLogo } from "@/components/blockwise-logo";

export function GuidesShell({ children }: { children: ReactNode }) {
  return (
    <div className="bw-guides-page">
      <a href="#main-content" className="bw-guides-skip-link">Skip to guides</a>
      <header className="bw-guides-header">
        <div className="bw-guides-header-in">
          <Link href="/" className="bw-guides-brand" aria-label="Blockwise home">
            <BlockwiseLogo />
          </Link>
          <nav aria-label="Publication navigation">
            <Link href="/guides">Guide library</Link>
            <Link href="/pricing">Pricing</Link>
          </nav>
        </div>
      </header>
      {children}
      <footer className="bw-guides-footer">
        <div className="bw-guides-footer-in">
          <div>
            <Link href="/" className="bw-guides-brand bw-guides-brand-light">
              <BlockwiseLogo />
            </Link>
            <p>Field notes for real-estate teams making advertising more useful.</p>
          </div>
          <div className="bw-guides-footer-links">
            <Link href="/guides">Guide library</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </div>
        </div>
        <div className="bw-guides-footer-legal">© 2026 Blockwise. All rights reserved.</div>
      </footer>
    </div>
  );
}
