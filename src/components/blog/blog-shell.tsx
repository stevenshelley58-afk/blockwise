import Link from "next/link";
import type { ReactNode } from "react";

export function BlogShell({ children }: { children: ReactNode }) {
  return (
    <div className="bw-blog-page">
      <header className="bw-blog-header">
        <div className="bw-blog-header-in">
          <Link href="/" className="bw-blog-brand" aria-label="Blockwise home">
            <span className="bw-blog-brand-mark" aria-hidden />
            <span>blockwise</span>
          </Link>
          <nav aria-label="Guides">
            <Link href="/blog">Field guides</Link>
            <Link href="/pricing">Pricing</Link>
          </nav>
          <Link href="/signup" className="bw-blog-header-cta">
            Start free trial
          </Link>
        </div>
      </header>
      {children}
      <footer className="bw-blog-footer">
        <div className="bw-blog-footer-in">
          <div>
            <Link href="/" className="bw-blog-brand bw-blog-brand-light">
              <span className="bw-blog-brand-mark" aria-hidden />
              <span>blockwise</span>
            </Link>
            <p>Practical advertising field guides for Australian real-estate teams.</p>
          </div>
          <div className="bw-blog-footer-links">
            <Link href="/blog">Field guides</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </div>
        </div>
        <div className="bw-blog-footer-legal">© 2026 Blockwise. All rights reserved.</div>
      </footer>
    </div>
  );
}
