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
          <nav aria-label="Guides">
            <Link href="/guides" aria-current="page">Guides</Link>
            <Link href="/pricing">Pricing</Link>
          </nav>
          <Link href="/signup" className="bw-guides-header-cta">
            Start free trial
          </Link>
        </div>
      </header>
      {children}
      <footer className="bw-guides-footer">
        <div className="bw-guides-footer-in">
          <div>
            <Link href="/" className="bw-guides-brand bw-guides-brand-light">
              <BlockwiseLogo />
            </Link>
            <p>Practical advertising guides for real-estate teams.</p>
          </div>
          <div className="bw-guides-footer-links">
            <Link href="/guides">Guides</Link>
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
