import type { Metadata } from "next";
import Link from "next/link";

import { CtaLink } from "@/components/landing/cta-link";
import { DemoForm } from "@/components/landing/demo-form";
import { HomeMotion } from "@/components/landing/home-motion";
import { SignInLink } from "@/components/landing/sign-in-link";
import { LandingAdRadarScan } from "@/components/research/landing-ad-radar-scan";
import { LandingRadarCards } from "@/components/research/landing-radar-cards";

import "./home-redesign.css";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/**
 * Blockwise homepage — "local signal -> leads" redesign, wired to real flows:
 * the hero uses the real public Ad Radar scan (LandingAdRadarScan), a Local Ad
 * Radar section renders real scraped ads (LandingRadarCards), and a working
 * lead form (DemoForm -> /api/demo-request) sits at the bottom (#managed-setup).
 * Pricing mirrors the real single $799/mo plan. Styling is scoped under `.bwx`
 * (./home-redesign.css). Animations are progressive enhancement via HomeMotion.
 */

const INCLUDED = [
  "Up to 10 ad packs per month",
  "Campaign builder (Just Listed, Open Home, Just Sold, Free Appraisal, Buyer Demand, Market Update)",
  "Meta ad account connection",
  "Team approval workflow",
  "Live performance reporting",
  "Email support",
];

const FIG_SVG = `<svg viewBox="0 0 1500 360" role="img" aria-label="Scan the suburb, prepare the campaign, leads come in"><defs><linearGradient id="bRail" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4f97ff"/><stop offset=".5" stop-color="#2fd2c2"/><stop offset="1" stop-color="#9a7fff"/></linearGradient><linearGradient id="bC1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f97ff"/><stop offset="1" stop-color="#1f5fd6"/></linearGradient><linearGradient id="bC2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2fd2c2"/><stop offset="1" stop-color="#10a294"/></linearGradient><linearGradient id="bSweep" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2fd2c2" stop-opacity="0"/><stop offset="1" stop-color="#2fd2c2" stop-opacity=".5"/></linearGradient><filter id="bShadow" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="9" stdDeviation="12" flood-color="#1f3a7a" flood-opacity="0.10"/></filter></defs><line x1="250" y1="180" x2="1290" y2="180" stroke="#dde3ee" stroke-width="2" stroke-dasharray="2 9"/><path id="bSig" class="bwx-bSig" d="M250,180 C430,90 560,90 700,180 S950,270 1100,180 1230,120 1290,150" pathLength="1" fill="none" stroke="url(#bRail)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><circle r="6" fill="#1fb3a6" opacity=".9"><animateMotion dur="2.8s" repeatCount="indefinite"><mpath href="#bSig"/></animateMotion></circle><circle cx="300" cy="180" r="102" fill="#fff" filter="url(#bShadow)"/><circle cx="300" cy="180" r="86" fill="none" stroke="#2fbfb0" stroke-opacity="0.22" stroke-width="2.2"/><circle cx="300" cy="180" r="53" fill="none" stroke="#2fbfb0" stroke-opacity="0.32" stroke-width="2.2"/><circle cx="300" cy="180" r="26" fill="none" stroke="#2fbfb0" stroke-opacity="0.44" stroke-width="2.2"/><path d="M300,180 L346,107 A86,86 0 0,1 386,183 Z" fill="url(#bSweep)"><animateTransform attributeName="transform" type="rotate" from="0 300 180" to="360 300 180" dur="5s" repeatCount="indefinite"/></path><circle class="bwx-bBlip" cx="318" cy="115" r="5" fill="#1f6feb"/><circle class="bwx-bBlip" cx="237" cy="192" r="5" fill="#1f6feb"/><circle cx="300" cy="180" r="5" fill="#2fbfb0"/><rect x="678" y="108" width="144" height="144" rx="28" fill="#fff" filter="url(#bShadow)"/><rect x="698" y="126" width="104" height="42" rx="10" fill="url(#bC1)"/><rect x="698" y="178" width="104" height="8" rx="4" fill="#e3e7ee"/><rect x="698" y="192" width="70" height="8" rx="4" fill="#eaedf2"/><rect x="698" y="212" width="60" height="20" rx="10" fill="url(#bC2)"/><text x="728" y="226" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">Ready</text><rect x="1080" y="102" width="240" height="156" rx="22" fill="#fff" filter="url(#bShadow)"/><text x="1102" y="134" font-size="13" font-weight="700" letter-spacing="1" fill="#8a90a0">LAST 7 DAYS</text><circle cx="1262" cy="129" r="5" fill="#23a35e"/><text x="1274" y="134" font-size="12.5" font-weight="700" fill="#23a35e">Live</text><text id="bLeads" x="1102" y="188" font-size="40" font-weight="800" fill="#0f1115">0</text><text x="1102" y="212" font-size="14" fill="#6b7280">leads</text><line x1="1196" y1="152" x2="1196" y2="214" stroke="#eef0f4" stroke-width="2"/><text id="bCpl" x="1218" y="188" font-size="40" font-weight="800" fill="#0f1115">$0</text><text x="1218" y="212" font-size="14" fill="#6b7280">cost / lead</text><path class="bwx-bSpark" d="M1102,237 L1124,233 L1146,235 L1168,227 L1190,229 L1212,221 L1234,223" pathLength="1" fill="none" stroke="#1fb3a6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="1234" cy="223" r="4" fill="#1fb3a6"/></svg>`;
const CHART_SVG = `<svg viewBox="0 0 600 210" role="img" aria-label="Leads over the last 7 days, trending up"><defs><linearGradient id="leadFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f6feb" stop-opacity=".20"/><stop offset="1" stop-color="#1f6feb" stop-opacity="0"/></linearGradient></defs><line x1="40" y1="20" x2="568" y2="20" stroke="#eef0f3"/><line x1="40" y1="95" x2="568" y2="95" stroke="#eef0f3"/><line x1="40" y1="170" x2="568" y2="170" stroke="#eef0f3"/><path d="M40,128 L128,108 L216,116 L304,82 L392,90 L480,52 L568,33 L568,170 L40,170 Z" fill="url(#leadFill)"/><polyline points="40,128 128,108 216,116 304,82 392,90 480,52 568,33" fill="none" stroke="#1f6feb" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/><circle cx="568" cy="33" r="5" fill="#fff" stroke="#1f6feb" stroke-width="2.6"/><g fill="#9aa0aa" font-size="11" font-family="inherit" text-anchor="middle"><text x="40" y="196">Mon</text><text x="128" y="196">Tue</text><text x="216" y="196">Wed</text><text x="304" y="196">Thu</text><text x="392" y="196">Fri</text><text x="480" y="196">Sat</text><text x="568" y="196">Sun</text></g></svg>`;

function Check() {
  return (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}><path d="m5 13 4 4L19 7" /></svg>);
}

export default function HomePage() {
  return (
    <div className="bwx">
      <header className="bwx-nav">
        <Link className="bwx-brand" href="/"><span className="bwx-mark" />blockwise</Link>
        <nav className="bwx-nav__links">
          <a href="#radar">Ad Radar</a>
          <a href="#how">How it works</a>
          <Link href="/pricing">Pricing</Link>
        </nav>
        <div className="bwx-nav__cta">
          <span className="bwx-nav__login"><SignInLink /></span>
          <CtaLink location="nav" href="/signup" className="bwx-btn bwx-btn--ink bwx-btn--sm">Start free</CtaLink>
        </div>
      </header>

      <main className="bwx-wrap">
        <section className="bwx-hero bwx-stagger">
          <span className="bwx-eyebrow"><span className="bwx-dot" /> Meta ads for real estate agents</span>
          <h1>See every ad running in your suburb.</h1>
          <p className="bwx-sub">Ads built from what&rsquo;s actually working in your area. Start getting leads today.</p>
          <div className="bwx-searchwrap bwx-scan">
            <LandingAdRadarScan
              buttonLabel="Show me the ads"
              initialNote="Start with Perth, WA or choose your suburb."
              initialValue="Perth, WA"
              placeholder="Enter a suburb, postcode, agent or agency"
              useBestGuess
            />
          </div>
          <p className="bwx-trial">7-day trial · 10 ad packs · <b>No card required</b></p>
        </section>

        <section className="bwx-how" id="radar" style={{ borderTop: "none", paddingTop: 4 }}>
          <div className="bwx-how__head bwx-reveal">
            <span className="bwx-eyebrow"><span className="bwx-dot" /> Local Ad Radar</span>
            <h2>See what&rsquo;s already running nearby.</h2>
            <p className="bwx-how__sub">Live real estate ads from your area — refreshed automatically.</p>
          </div>
          <LandingRadarCards />
        </section>

        <section className="bwx-how" id="how">
          <div className="bwx-how__head bwx-reveal">
            <span className="bwx-eyebrow"><span className="bwx-dot" /> How it works</span>
            <h2>From local signal to real leads.</h2>
            <p className="bwx-how__sub">We scan the area, prepare the campaign, and the leads come in.</p>
          </div>
          <div className="bwx-how-fig bwx-reveal" id="bFig" dangerouslySetInnerHTML={{ __html: FIG_SVG }} />
          <ol className="bwx-how__steps2 bwx-reveal">
            <li className="bwx-how__s"><b><em className="bwx-e1">1</em> Scan</b><p>See local lead angles.</p></li>
            <li className="bwx-how__s"><b><em className="bwx-e2">2</em> Prepared</b><p>Blockwise prepares the campaign.</p></li>
            <li className="bwx-how__s"><b><em className="bwx-e3">3</em> Leads</b><p>Approve, run, and track results.</p></li>
          </ol>
        </section>

        <section className="bwx-dash" id="dash">
          <div className="bwx-dash__head bwx-reveal">
            <span className="bwx-eyebrow"><span className="bwx-dot" /> Live dashboard</span>
            <h2>Finally understand what your ads are doing.</h2>
            <p className="bwx-lead">Leads, spend and clicks in one clean view — updated live. No spreadsheets, no digging through Meta Ads Manager.</p>
          </div>
          <div className="bwx-board bwx-reveal">
            <div className="bwx-board__bar">
              <div className="bwx-board__title">Campaign performance <span className="bwx-board__live"><i /> Live</span></div>
              <div className="bwx-board__range">
                <button type="button" aria-pressed="true">7d</button>
                <button type="button" aria-pressed="false">30d</button>
                <button type="button" aria-pressed="false">90d</button>
              </div>
            </div>
            <div className="bwx-kpis bwx-stagger">
              <div className="bwx-kpi"><div className="bwx-kpi__k">Leads</div><div className="bwx-kpi__v"><span className="bwx-count" data-count="47">47</span></div><span className="bwx-delta">▲ 18% vs last week</span></div>
              <div className="bwx-kpi"><div className="bwx-kpi__k">Ad spend</div><div className="bwx-kpi__v"><span className="bwx-count" data-count="612" data-prefix="$">$612</span></div><span className="bwx-delta bwx-delta--muted">$25 / day · on track</span></div>
              <div className="bwx-kpi"><div className="bwx-kpi__k">Clicks</div><div className="bwx-kpi__v"><span className="bwx-count" data-count="1940">1,940</span></div><span className="bwx-delta">▲ 9% vs last week</span></div>
              <div className="bwx-kpi"><div className="bwx-kpi__k">Cost per lead</div><div className="bwx-kpi__v"><span className="bwx-count" data-count="13.02" data-prefix="$" data-decimals="2">$13.02</span></div><span className="bwx-delta">▼ 6% — cheaper</span></div>
            </div>
            <div className="bwx-board__chart" dangerouslySetInnerHTML={{ __html: CHART_SVG }} />
            <div className="bwx-chart-legend">
              <span><i style={{ background: "#1f6feb" }} /> Leads this week</span>
              <span><i style={{ background: "#dfe3e8" }} /> Previous week</span>
            </div>
            <div className="bwx-camps">
              <div className="bwx-crow bwx-crow--head"><span>Campaign</span><span>Status</span><span className="bwx-crow__num">Leads</span><span className="bwx-crow__num bwx-crow__spend">Spend</span></div>
              <div className="bwx-crow"><span className="bwx-crow__name">Mt Lawley · Free appraisal</span><span className="bwx-cstatus bwx-cstatus--active"><i /> Active</span><span className="bwx-crow__num">18</span><span className="bwx-crow__num bwx-crow__spend">$324</span></div>
              <div className="bwx-crow"><span className="bwx-crow__name">Subiaco · Just listed</span><span className="bwx-cstatus bwx-cstatus--active"><i /> Active</span><span className="bwx-crow__num">11</span><span className="bwx-crow__num bwx-crow__spend">$210</span></div>
              <div className="bwx-crow"><span className="bwx-crow__name">Cottesloe · Open home</span><span className="bwx-cstatus bwx-cstatus--paused"><i /> Paused</span><span className="bwx-crow__num">7</span><span className="bwx-crow__num bwx-crow__spend">$98</span></div>
            </div>
          </div>
        </section>

        <section className="bwx-trust">
          <div className="bwx-trust__grid">
            <div className="bwx-trust__copy bwx-reveal">
              <span className="bwx-eyebrow"><span className="bwx-dot" /> Approval &amp; control</span>
              <h2>Nothing spends until you say so.</h2>
              <p className="bwx-lead">Blockwise builds the ad — you approve it. You stay in control of every dollar, every claim and every campaign.</p>
              <ul className="bwx-checks bwx-stagger">
                <li><Check /> Approve every ad before it goes live</li>
                <li><Check /> Runs through your own Meta ad account</li>
                <li><Check /> You set the budget and the schedule</li>
                <li><Check /> Claims &amp; brand checked before sign-off</li>
              </ul>
            </div>
            <aside className="bwx-approve bwx-reveal" aria-label="Ad pending your approval">
              <div className="bwx-approve__top"><span>Ready for your approval</span><span className="bwx-approve__tag">1 pending</span></div>
              <div className="bwx-approve__ad">
                <div className="bwx-approve__img bwx-g3" />
                <div className="bwx-approve__adtxt"><b>Free appraisal · Mount Lawley</b><span>What&rsquo;s your home worth in today&rsquo;s market? Free, no-obligation appraisal.</span></div>
              </div>
              <div className="bwx-approve__rows">
                <div><span>Budget</span><b>$25 / day</b></div>
                <div><span>Audience</span><b>Mount Lawley · 8 km</b></div>
                <div><span>Billed to</span><b>Your Meta account</b></div>
              </div>
              <div className="bwx-approve__btns">
                <CtaLink location="approve-card" href="/signup" className="bwx-btn bwx-btn--ink">Approve &amp; launch</CtaLink>
                <CtaLink location="approve-card-edit" href="/signup" className="bwx-btn bwx-btn--ghost">Edit</CtaLink>
              </div>
              <p className="bwx-approve__note">Ad spend is billed by Meta directly to your account — never to Blockwise.</p>
            </aside>
          </div>
        </section>

        <section className="bwx-pricing" id="pricing">
          <div className="bwx-pricing__head bwx-reveal">
            <span className="bwx-eyebrow"><span className="bwx-dot" /> Pricing</span>
            <h2>Simple pricing. Cancel anytime.</h2>
            <p className="bwx-lead">One plan, everything included. Start with a free 7-day trial and 10 ad packs — your ad spend is always separate and paid to Meta.</p>
          </div>
          <div className="bwx-ptiers bwx-stagger" style={{ gridTemplateColumns: "minmax(0,460px)", justifyContent: "center" }}>
            <div className="bwx-ptier bwx-ptier--pop">
              <span className="bwx-ptier__badge">Everything included</span>
              <div className="bwx-ptier__name">Blockwise</div>
              <div className="bwx-ptier__price">$799<em> /mo</em></div>
              <div className="bwx-ptier__per">Then $799/month · less than half a typical agency retainer</div>
              <p className="bwx-ptier__desc">For real estate teams who want local Meta ads running — built, approved and tracked — without opening Ads Manager.</p>
              <CtaLink location="pricing" href="/signup" className="bwx-btn bwx-btn--ink">Start free — no card</CtaLink>
              <ul className="bwx-plist">
                {INCLUDED.map((item) => (<li key={item}><Check /> {item}</li>))}
              </ul>
              <Link href="/pricing" className="bwx-btn bwx-btn--ghost" style={{ marginTop: 14, width: "100%", justifyContent: "center" }}>See full pricing</Link>
            </div>
          </div>
          <p className="bwx-pricing__note">7-day free trial · 10 free ad packs · No card required · Ad spend paid separately to Meta</p>
        </section>

        <section className="bwx-cta bwx-reveal">
          <span className="bwx-eyebrow"><span className="bwx-dot" /> Get started</span>
          <h2>See what&rsquo;s running in your suburb today.</h2>
          <p>Search your area free, see the live ads, and build your first campaign in minutes.</p>
          <div className="bwx-cta__btns">
            <CtaLink location="closing" href="/signup" className="bwx-btn bwx-btn--white">Start free — no card</CtaLink>
            <CtaLink location="closing-demo" href="#managed-setup" className="bwx-btn bwx-btn--outline">Book a 15-min walkthrough</CtaLink>
          </div>
        </section>

        <section className="bwx-trust" id="managed-setup" aria-labelledby="demo-title">
          <div className="bwx-trust__grid">
            <div className="bwx-trust__copy bwx-reveal">
              <span className="bwx-eyebrow"><span className="bwx-dot" /> Managed setup</span>
              <h2 id="demo-title">Want help preparing your first campaign?</h2>
              <p className="bwx-lead">Book a 15-minute walkthrough and we&rsquo;ll help you create your first campaign, connect your ad account and review everything before handoff.</p>
            </div>
            <div className="bwx-reveal"><DemoForm /></div>
          </div>
        </section>
      </main>

      <footer className="bwx-site">
        <div className="bwx-foot">
          <div className="bwx-foot__brand-col">
            <div className="bwx-foot__brand"><span className="bwx-mark" />blockwise</div>
            <p>Meta ads for real estate agents. See what&rsquo;s running nearby, then launch ads built from what&rsquo;s working in your area.</p>
            <a className="bwx-foot__mail" href="mailto:hello@blockwise.sale">hello@blockwise.sale</a>
          </div>
          <div className="bwx-foot__col">
            <h4>Product</h4>
            <a href="#radar">Ad Radar</a>
            <a href="#how">How it works</a>
            <Link href="/pricing">Pricing</Link>
            <a href="#managed-setup">Book a walkthrough</a>
          </div>
          <div className="bwx-foot__col">
            <h4>Company</h4>
            <a href="mailto:hello@blockwise.sale">Contact</a>
            <CtaLink location="footer" href="/signup">Start free</CtaLink>
            <Link href="/login">Log in</Link>
          </div>
          <div className="bwx-foot__col">
            <h4>Legal</h4>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/data-deletion">Data deletion</Link>
          </div>
        </div>
        <div className="bwx-foot__bot">
          <div>
            <span>© 2026 Blockwise. All rights reserved.</span>
            <span>Perth, WA · built for real estate teams</span>
          </div>
        </div>
      </footer>

      <HomeMotion />
    </div>
  );
}
