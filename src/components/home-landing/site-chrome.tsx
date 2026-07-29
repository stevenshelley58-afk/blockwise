import Link from "next/link";

import { CtaLink } from "@/components/landing/cta-link";
import { SignInLink } from "@/components/landing/sign-in-link";

/** N9 edge-aligned minimal header — static, hairline bottom, no hamburger. */
export function SiteHeader() {
  return (
    <header className="hw-header">
      <div className="hw-wide hw-header-inner">
        <Link href="/" className="hw-logo" aria-label="Blockwise home">
          <img
            className="hw-logo-horizontal"
            src="/brand/blockwise-logo.svg"
            alt="blockwise"
            width="420"
            height="100"
          />
          <img
            className="hw-logo-icon"
            src="/brand/blockwise-icon-midnight.svg"
            alt="blockwise"
            width="1024"
            height="1024"
          />
        </Link>
        <nav className="hw-nav" aria-label="Main">
          <Link href="/#start">How it works</Link>
          <Link href="/pricing">Pricing</Link>
          <Link href="/guides">Guides</Link>
        </nav>
        <div className="hw-header-actions">
          <SignInLink className="hw-login" />
          <CtaLink location="header" href="/signup" className="hw-btn hw-btn--dark">
            Start free
          </CtaLink>
        </div>
      </div>
    </header>
  );
}

/** Ft5 Statement footer — dark fold, one statement, one action, one link row. */
export function SiteFooter() {
  return (
    <footer className="hw-footer">
      <div className="hw-wide hw-footer-statement-block">
        <p className="hw-footer-statement">Your competitors are still advertising.</p>
        <CtaLink location="footer" href="/signup" className="hw-btn hw-btn--light">
          Create three ads free <span className="hw-arr">→</span>
        </CtaLink>
      </div>
      <div className="hw-wide">
        <div className="hw-footer-rule" aria-hidden />
        <div className="hw-footer-row">
          <span className="hw-logo hw-logo--footer">
            <img
              className="hw-logo-horizontal"
              src="/brand/blockwise-logo-white.svg"
              alt="blockwise"
              width="420"
              height="100"
            />
          </span>
          <nav className="hw-footer-links" aria-label="Footer">
            <Link href="/#start">How it works</Link>
            <Link href="/#free-trial">Start free</Link>
            <Link href="/pricing">Pricing</Link>
            <Link href="/guides">Guides</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/data-deletion">Data deletion</Link>
            <a href="mailto:hello@blockwise.sale">hello@blockwise.sale</a>
          </nav>
        </div>
        <p className="hw-footer-legal">
          © 2026 Blockwise. All rights reserved. Blockwise is operated by SHELLEY, STEVEN JOHN.
        </p>
      </div>
    </footer>
  );
}
