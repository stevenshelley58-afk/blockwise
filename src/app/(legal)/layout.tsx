import Link from "next/link";

import { BlockwiseLogo } from "@/components/blockwise-logo";

export default function LegalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="site-shell legal-shell">
      <header className="site-nav" aria-label="Primary">
        <Link className="site-brand" href="/" aria-label="Blockwise home">
          <BlockwiseLogo />
        </Link>
        <nav className="site-nav-actions" aria-label="Account">
          <Link href="/login">Client sign in</Link>
          <a className="button" href="mailto:hello@blockwise.sale?subject=Blockwise%20demo">
            Request access
          </a>
        </nav>
      </header>

      <article
        className="legal-article"
        style={{
          maxWidth: 760,
          margin: "0 auto",
          padding: "64px 24px 96px",
          fontSize: 16,
          lineHeight: 1.7,
          color: "#131b2e",
        }}
      >
        {children}
      </article>

      <footer
        className="site-footer"
        aria-label="Footer"
        style={{ alignItems: "flex-start", flexDirection: "column", gap: 12 }}
      >
        <BlockwiseLogo />
        <nav
          aria-label="Legal"
          style={{ display: "flex", gap: 18, fontSize: 13, color: "#475569", flexWrap: "wrap" }}
        >
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/data-deletion">Data deletion</Link>
          <a href="mailto:hello@blockwise.sale">hello@blockwise.sale</a>
        </nav>
        <span className="footer-fine">© {new Date().getFullYear()} Blockwise</span>
      </footer>
    </main>
  );
}
