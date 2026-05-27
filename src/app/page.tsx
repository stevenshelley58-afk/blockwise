import { ArrowRight, Building2, CheckCircle2, Gauge, ShieldCheck, Sparkles, UsersRound } from "lucide-react";
import Link from "next/link";

const proofPoints = [
  "Workspace-isolated client data",
  "Human approval before publishing",
  "AI spend and model controls",
  "Lead dedupe and export audits",
];

const clientPaths = [
  {
    icon: Gauge,
    title: "Monitor",
    copy: "Connect ad accounts, watch lead quality, and see sync health without changing campaigns.",
  },
  {
    icon: Sparkles,
    title: "Self-Serve",
    copy: "Turn suburb signals, offers, and brand rules into reviewable lead-generation campaigns.",
  },
  {
    icon: UsersRound,
    title: "Managed Operator",
    copy: "Let an operator review blocked outputs, approvals, and agent work before anything leaves Blockwise.",
  },
];

export default function HomePage() {
  return (
    <main className="site-shell">
      <header className="site-nav" aria-label="Primary">
        <Link className="site-brand" href="/" aria-label="Blockwise home">
          <span className="brand-mark">B</span>
          <span>Blockwise</span>
        </Link>
        <nav className="site-nav-actions" aria-label="Account">
          <Link href="/login">Client sign in</Link>
          <a className="button" href="mailto:hello@blockwise.sale?subject=Blockwise%20access%20request">
            Request access
          </a>
        </nav>
      </header>

      <section className="home-hero">
        <div className="hero-copy">
          <p className="eyebrow">Real estate lead generation control plane</p>
          <h1>Blockwise</h1>
          <p className="hero-lead">
            Secure campaign monitoring, self-serve drafting, lead handling, and agent approvals for real estate teams
            that cannot afford client-data leakage.
          </p>
          <div className="actions">
            <a className="button" href="mailto:hello@blockwise.sale?subject=Blockwise%20access%20request">
              Request access
              <ArrowRight aria-hidden size={18} />
            </a>
            <Link className="button secondary" href="/login">
              Client sign in
            </Link>
          </div>
        </div>

        <div className="hero-product" aria-label="Blockwise security and campaign dashboard preview">
          <div className="hero-product-topbar">
            <span>Northstar Realty</span>
            <span>AU workspace</span>
          </div>
          <div className="hero-product-grid">
            <div className="hero-product-panel wide">
              <div>
                <span className="mini-label">Approval Queue</span>
                <strong>6 gated actions</strong>
              </div>
              <span className="status amber">Human review</span>
            </div>
            <div className="hero-product-panel">
              <span className="mini-label">AI spend</span>
              <strong>$184</strong>
              <span className="trend-line" aria-hidden />
            </div>
            <div className="hero-product-panel">
              <span className="mini-label">Leads</span>
              <strong>122</strong>
              <span className="status green">Dedupe on</span>
            </div>
            <div className="hero-product-panel wide">
              <span className="mini-label">Agent run</span>
              <strong>Campaign Draft Agent</strong>
              <p>Workspace policy checked, provider tokens withheld, output stored for review.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="home-band" aria-labelledby="security-heading">
        <div>
          <p className="eyebrow">Built for client isolation</p>
          <h2 id="security-heading">Every account gets a hard workspace boundary.</h2>
        </div>
        <div className="proof-grid">
          {proofPoints.map((point) => (
            <div className="proof-item" key={point}>
              <CheckCircle2 aria-hidden size={18} />
              <span>{point}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="home-section" aria-labelledby="paths-heading">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Choose the right start</p>
            <h2 id="paths-heading">Simple paths for new clients.</h2>
          </div>
          <a className="button secondary" href="mailto:hello@blockwise.sale?subject=Blockwise%20setup%20call">
            Book setup
          </a>
        </div>
        <div className="grid cols-3">
          {clientPaths.map((path) => {
            const Icon = path.icon;

            return (
              <article className="item-card home-card" key={path.title}>
                <Icon aria-hidden color="#087f7a" size={24} />
                <h3>{path.title}</h3>
                <p className="item-meta">{path.copy}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="home-final" aria-labelledby="ready-heading">
        <Building2 aria-hidden color="#2364aa" size={28} />
        <div>
          <h2 id="ready-heading">Ready for private onboarding.</h2>
          <p>
            New clients can request access, then sign in after their workspace, role, region, and provider connections
            are provisioned.
          </p>
        </div>
        <ShieldCheck aria-hidden color="#2f7d32" size={28} />
      </section>
    </main>
  );
}
