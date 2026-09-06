"use client";

import {
  ArrowRight,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Mail,
  MousePointer2,
  PencilLine,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AdPreview } from "@/components/homepage-concept/ad-preview";
import { AD_EXAMPLES, FAQS, withBasePath } from "@/lib/homepage-concept/content";
import { requestMockTrial, validateTrialEmail } from "@/lib/homepage-concept/mock-trial";

type FormState = "idle" | "loading" | "success" | "error";

function PrimaryLink({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <a className={`hc-button hc-button--primary ${className}`} href="#trial">
      {children}
      <ArrowRight aria-hidden="true" size={17} />
    </a>
  );
}

function TrialForm() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<FormState>("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === "loading") return;

    const validationError = validateTrialEmail(email);
    if (validationError) {
      setState("error");
      setMessage(validationError);
      return;
    }

    setState("loading");
    setMessage("");
    try {
      const result = await requestMockTrial(email);
      setState("success");
      setMessage(result.message);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Try again.");
    }
  }

  return (
    <form className="hc-trial-form" onSubmit={handleSubmit} noValidate>
      <label htmlFor="trial-email">Work email</label>
      <div className="hc-trial-row">
        <input
          id="trial-email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          placeholder="you@agency.com.au"
          value={email}
          aria-invalid={state === "error"}
          aria-describedby="trial-note trial-status"
          disabled={state === "loading"}
          onChange={(event) => {
            setEmail(event.target.value);
            if (state !== "idle") {
              setState("idle");
              setMessage("");
            }
          }}
        />
        <button className="hc-button hc-button--light" type="submit" disabled={state === "loading"}>
          {state === "loading" ? "Preparing demo…" : "Start free trial"}
          {state === "loading" ? <span className="hc-spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" size={17} />}
        </button>
      </div>
      <p id="trial-note" className="hc-form-note">No card required. Ad spend is separate.</p>
      <p
        id="trial-status"
        className={`hc-form-status hc-form-status--${state}`}
        role={state === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        {message || "Preview form only — nothing will be sent or saved."}
      </p>
    </form>
  );
}

function ProcessMiniatures() {
  return (
    <div className="hc-process-grid">
      <article className="hc-process-card">
        <div className="hc-step-number">1</div>
        <div className="hc-template-mini" aria-hidden="true">
          <img src={withBasePath(AD_EXAMPLES[0].image)} alt="" width="1080" height="1350" />
          <span><Check size={13} /> Selected</span>
        </div>
        <h3>Choose a template</h3>
        <p>Pick a ready-made ad.</p>
      </article>
      <article className="hc-process-card">
        <div className="hc-step-number">2</div>
        <div className="hc-editor-mini" aria-hidden="true">
          <div className="hc-editor-preview">
            <img src={withBasePath(AD_EXAMPLES[1].image)} alt="" width="1080" height="1350" />
          </div>
          <div className="hc-editor-fields">
            <span /><span /><span className="hc-editor-field-short" />
          </div>
          <PencilLine size={18} />
        </div>
        <h3>Make it yours</h3>
        <p>Your photos. Your brand.</p>
      </article>
      <article className="hc-process-card">
        <div className="hc-step-number">3</div>
        <div className="hc-approve-mini" aria-hidden="true">
          <span><CheckCircle2 size={17} /> Creative ready</span>
          <span><CheckCircle2 size={17} /> Budget checked</span>
          <strong>Launch <Send size={15} /></strong>
        </div>
        <h3>Approve and launch</h3>
        <p>Check the ad and budget.</p>
      </article>
    </div>
  );
}

function ResultsPanel() {
  return (
    <div className="hc-results-panel">
      <div className="hc-results-topline">
        <span>Mt Lawley appraisal</span>
        <span className="hc-live"><i /> Active</span>
      </div>
      <div className="hc-results-label">Example data</div>
      <div className="hc-results-stats">
        <div><strong>18</strong><span>Leads</span></div>
        <div><strong>$324</strong><span>Spend</span></div>
        <div><strong>$18</strong><span>Per lead</span></div>
      </div>
      <div className="hc-chart" aria-label="Example chart showing leads increasing over fourteen days">
        <div className="hc-chart-head"><span>Leads</span><span>Last 14 days</span></div>
        <svg viewBox="0 0 520 122" preserveAspectRatio="none" role="img" aria-hidden="true">
          <defs>
            <linearGradient id="hc-chart-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2a78d6" stopOpacity=".35" />
              <stop offset="100%" stopColor="#2a78d6" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d="M0 111 L44 100 L88 103 L132 81 L176 88 L220 64 L264 70 L308 48 L352 54 L396 31 L440 40 L480 17 L520 23 L520 122 L0 122 Z" fill="url(#hc-chart-fill)" />
          <polyline points="0,111 44,100 88,103 132,81 176,88 220,64 264,70 308,48 352,54 396,31 440,40 480,17 520,23" fill="none" stroke="#2a78d6" strokeWidth="3" />
        </svg>
      </div>
      <div className="hc-email-mini">
        <Mail aria-hidden="true" size={19} />
        <span><strong>Your ads yesterday</strong><small>3 new leads · $42 spend · 2 ads active</small></span>
        <ChevronRight aria-hidden="true" size={18} />
      </div>
    </div>
  );
}

export function HomepageConcept() {
  const [selectedExample, setSelectedExample] = useState(0);
  const activeExample = AD_EXAMPLES[selectedExample];
  const exampleDetails = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const phone = window.matchMedia("(max-width: 600px)");
    const syncDisclosure = () => {
      if (exampleDetails.current) exampleDetails.current.open = !phone.matches;
    };
    syncDisclosure();
    phone.addEventListener("change", syncDisclosure);
    return () => phone.removeEventListener("change", syncDisclosure);
  }, []);

  return (
    <div className="hc-root">
      <header className="hc-header">
        <a className="hc-logo" href="#top" aria-label="Blockwise homepage concept">
          <img src={withBasePath("/brand/blockwise-logo-white.svg")} alt="Blockwise" width="142" height="32" />
        </a>
        <nav aria-label="Primary navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#examples">Examples</a>
          <a href="#faq">FAQ</a>
        </nav>
        <a className="hc-header-cta" href="#trial">Start free trial</a>
      </header>

      <main>
        <section className="hc-hero" id="top">
          <div className="hc-shell hc-hero-grid">
            <div className="hc-hero-copy">
              <h1>Facebook &amp; Instagram ads. <span>Built for real estate.</span></h1>
              <p>Create, approve and track your ads in one place.</p>
              <div className="hc-hero-actions">
                <PrimaryLink>Start free trial</PrimaryLink>
                <span><Check aria-hidden="true" size={16} /> No card required.</span>
              </div>
            </div>
            <div className="hc-hero-product">
              <div className="hc-ready-bar"><span><i /> Ready to review</span><strong>Free appraisal ad</strong></div>
              <AdPreview
                image={AD_EXAMPLES[0].image}
                postCopy={AD_EXAMPLES[0].postCopy}
                linkTitle={AD_EXAMPLES[0].linkTitle}
                compact
              />
              <div className="hc-approval-bar">
                <span><ShieldCheck aria-hidden="true" size={18} /> Nothing spends until you approve.</span>
                <span className="hc-approval-button">Approve</span>
              </div>
            </div>
          </div>
        </section>

        <section className="hc-process hc-screen" id="how-it-works">
          <div className="hc-shell">
            <div className="hc-section-copy">
              <h2>From template to live ad.</h2>
            </div>
            <ProcessMiniatures />
            <div className="hc-centered-cta"><PrimaryLink>Start free trial</PrimaryLink><span>No card required.</span></div>
          </div>
        </section>

        <section className="hc-results hc-screen" id="results">
          <div className="hc-shell hc-results-grid">
            <div className="hc-results-copy">
              <h2>Your ads. Your leads. Your budget.</h2>
              <p>See what is live, what it costs and what needs your attention—without living in Ads Manager.</p>
              <ul>
                <li><Check aria-hidden="true" size={18} /> You approve before launch</li>
                <li><Check aria-hidden="true" size={18} /> Meta ad spend stays separate</li>
                <li><Check aria-hidden="true" size={18} /> Optional updates arrive by email</li>
              </ul>
              <PrimaryLink>Start free trial</PrimaryLink>
              <span className="hc-inline-note">No card required.</span>
            </div>
            <ResultsPanel />
          </div>
        </section>

        <section className="hc-examples" id="examples">
          <div className="hc-shell">
            <div className="hc-section-copy hc-section-copy--wide">
              <h2>Your brand. Your ads.</h2>
              <p>Choose an objective, then adapt the creative and message to your agency.</p>
            </div>
            <div className="hc-example-tabs" role="group" aria-label="Choose an ad example">
              {AD_EXAMPLES.map((example, index) => (
                <button
                  key={example.id}
                  type="button"
                  id={`example-tab-${example.id}`}
                  aria-pressed={selectedExample === index}
                  onClick={() => setSelectedExample(index)}
                >
                  {example.label}
                </button>
              ))}
            </div>
            <div
              className="hc-example-stage"
              id="example-panel"
            >
              <details ref={exampleDetails} className="hc-example-copy hc-example-details" open>
                <summary>About this ad <ChevronRight aria-hidden="true" size={18} /></summary>
                <h3>{activeExample.title}</h3>
                <p>{activeExample.body}</p>
                <dl>
                  <div><dt>Objective</dt><dd>Lead generation</dd></div>
                  <div><dt>Format</dt><dd>Facebook &amp; Instagram feed</dd></div>
                  <div><dt>Approval</dt><dd>Required before launch</dd></div>
                </dl>
              </details>
              <AdPreview image={activeExample.image} postCopy={activeExample.postCopy} linkTitle={activeExample.linkTitle} />
            </div>
          </div>
        </section>

        <section className="hc-control" id="control">
          <div className="hc-shell hc-control-grid">
            <div className="hc-section-copy">
              <h2>You&rsquo;re in control.</h2>
              <p>Creative, budget, status and reporting—when you need the detail.</p>
            </div>
            <div className="hc-detail-list">
              <details open>
                <summary><span><MousePointer2 aria-hidden="true" size={20} /> Creative control</span><ChevronRight aria-hidden="true" size={20} /></summary>
                <p>Change the property, offer, copy, call to action and brand details before approval.</p>
              </details>
              <details>
                <summary><span><CircleDollarSign aria-hidden="true" size={20} /> Budget control</span><ChevronRight aria-hidden="true" size={20} /></summary>
                <p>Review the daily budget and schedule. Meta ad spend is separate and paid from your connected ad account.</p>
              </details>
              <details>
                <summary><span><BarChart3 aria-hidden="true" size={20} /> Campaign detail</span><ChevronRight aria-hidden="true" size={20} /></summary>
                <p>See status, spend and lead activity, with deeper campaign detail available when needed.</p>
              </details>
              <details>
                <summary><span><Clock3 aria-hidden="true" size={20} /> Helpful updates</span><ChevronRight aria-hidden="true" size={20} /></summary>
                <p>Use the dashboard for the full view or receive a short optional email update.</p>
              </details>
            </div>
          </div>
        </section>

        <section className="hc-faq" id="faq">
          <div className="hc-shell hc-faq-grid">
            <div className="hc-section-copy">
              <h2>Questions, answered plainly.</h2>
              <p>What to expect before you start.</p>
            </div>
            <div className="hc-faq-list">
              {FAQS.map((faq) => (
                <details key={faq.question}>
                  <summary>{faq.question}<span aria-hidden="true">+</span></summary>
                  <p>{faq.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="hc-trial" id="trial">
          <div className="hc-shell hc-trial-grid">
            <div>
              <h2>Start with your email.</h2>
              <p>Try the guided setup in this homepage concept.</p>
              <div className="hc-trial-points">
                <span><Sparkles aria-hidden="true" size={18} /> Polished templates</span>
                <span><ShieldCheck aria-hidden="true" size={18} /> Approval before launch</span>
                <span><BarChart3 aria-hidden="true" size={18} /> Results in one place</span>
              </div>
            </div>
            <TrialForm />
          </div>
        </section>
      </main>

      <footer className="hc-footer">
        <div className="hc-shell">
          <img src={withBasePath("/brand/blockwise-logo.svg")} alt="Blockwise" width="134" height="30" />
          <p>Real estate ads, made manageable.</p>
          <nav aria-label="Footer navigation">
            <a href="https://blockwise.sale/pricing" target="_blank" rel="noreferrer">Pricing</a>
            <a href="#top">Back to top</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
