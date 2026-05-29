"use client";

import {
  BadgeCheck,
  ClipboardCheck,
  Download,
  FileText,
  Image,
  Layers,
  Lock,
  Megaphone,
  MousePointer2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Unlock,
} from "lucide-react";
import { useMemo, useState } from "react";

import { StatusPill } from "@/components/status-pill";
import type {
  AdStudioBrandKit,
  AdStudioCampaignPack,
  AdStudioCanvasObject,
  AdStudioCreative,
  AdStudioFormat,
  AdStudioOfferTemplate,
  AdStudioPersistenceStatus,
} from "@/lib/adstudio";

type AdStudioWorkbenchProps = {
  brandKit: AdStudioBrandKit;
  campaignPack: AdStudioCampaignPack;
  offers: AdStudioOfferTemplate[];
  performance: {
    leads: number;
    costPerLeadAud: number;
    bookedAppraisals: number;
    bestFormat: string;
    recommendations: string[];
  };
};

const TABS = ["Dashboard", "Brand Kit", "Brief", "Offers", "Variants", "Editor", "Copy Pack", "Compliance", "Export", "Performance"] as const;
type Tab = (typeof TABS)[number];

const FORMATS: AdStudioFormat[] = ["1:1", "4:5", "9:16", "1.91:1"];

export function AdStudioWorkbench({
  brandKit: initialBrandKit,
  campaignPack: initialCampaignPack,
  offers,
  performance,
}: AdStudioWorkbenchProps) {
  const [activeTab, setActiveTab] = useState<Tab>("Dashboard");
  const [brandKit, setBrandKit] = useState(initialBrandKit);
  const [campaignPack, setCampaignPack] = useState(initialCampaignPack);
  const [websiteUrl, setWebsiteUrl] = useState(initialBrandKit.source.url);
  const [suburb, setSuburb] = useState(initialCampaignPack.campaign.market.suburb);
  const [selectedVariantId, setSelectedVariantId] = useState(campaignPack.variants[0]?.variantId ?? "");
  const [selectedFormat, setSelectedFormat] = useState<AdStudioFormat>("4:5");
  const [selectedObjectId, setSelectedObjectId] = useState("headline");
  const [advanced, setAdvanced] = useState(false);
  const [creatives, setCreatives] = useState(campaignPack.creatives);
  const [liveStatus, setLiveStatus] = useState<{ tone: "green" | "amber" | "rose" | "blue"; text: string }>({
    tone: "blue",
    text: "Live API mode",
  });
  const [liveEvents, setLiveEvents] = useState<string[]>([
    "Ready: paste an agency website, extract a brand kit, approve it, generate variants, then export.",
  ]);
  const [lastMetaPlanId, setLastMetaPlanId] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const selectedVariant = campaignPack.variants.find((variant) => variant.variantId === selectedVariantId) ?? campaignPack.variants[0];
  const selectedCopy = campaignPack.copyPacks.find((copy) => copy.variantId === selectedVariant?.variantId) ?? campaignPack.copyPacks[0];
  const selectedCreative =
    creatives.find((creative) => creative.variantId === selectedVariant?.variantId && creative.format === selectedFormat) ??
    creatives[0];
  const selectedObject = selectedCreative?.canvas.objects.find((object) => object.objectId === selectedObjectId);
  const approvedVariants = campaignPack.variants.filter((variant) => variant.status === "approved").length;
  const metricCards = [
    { label: "Variants", value: String(campaignPack.variants.length), note: `${approvedVariants} approved`, icon: Sparkles },
    { label: "Formats", value: String(campaignPack.campaign.creativeFormats.length), note: "Meta + Google ratios", icon: Image },
    { label: "Compliance", value: campaignPack.compliance.status, note: `${campaignPack.compliance.issues.length} issues`, icon: ShieldCheck },
    { label: "Export Pack", value: "Ready", note: "Images, copy, CSV, PDF", icon: Download },
  ];

  function updateSelectedObject(patch: Partial<AdStudioCanvasObject>) {
    if (!selectedCreative || !selectedObject) {
      return;
    }

    setCreatives((current) =>
      current.map((creative) =>
        creative.creativeId === selectedCreative.creativeId
          ? {
              ...creative,
              canvas: {
                ...creative.canvas,
                objects: creative.canvas.objects.map((object) =>
                  object.objectId === selectedObject.objectId ? { ...object, ...patch } : object,
                ),
              },
            }
          : creative,
      ),
    );
  }

  function moveSelectedObject(deltaX: number, deltaY: number) {
    if (!selectedObject || selectedObject.locked) {
      return;
    }

    updateSelectedObject({
      x: Math.max(0, selectedObject.x + deltaX),
      y: Math.max(0, selectedObject.y + deltaY),
    });
  }

  function pushLiveEvent(message: string) {
    setLiveEvents((current) => [message, ...current].slice(0, 6));
  }

  async function extractLiveBrandKit() {
    if (!websiteUrl.trim()) {
      setLiveStatus({ tone: "rose", text: "Enter a website URL first." });
      return;
    }

    setIsBusy(true);
    setLiveStatus({ tone: "blue", text: "Extracting website brand kit..." });
    pushLiveEvent(`Extracting brand kit from ${websiteUrl.trim()}...`);

    try {
      const payload = await requestJson<{ brandKit: AdStudioBrandKit; persistence: AdStudioPersistenceStatus }>("/api/adstudio/brand-kits/extract", {
        websiteUrl,
        marketCountry: "AU",
        marketRegion: "WA",
      });
      setBrandKit(payload.brandKit);
      setLiveStatus({
        tone: payload.persistence.status === "persisted" ? "amber" : "rose",
        text:
          payload.persistence.status === "persisted"
            ? "Brand kit extracted and saved. Review and approve it before generation."
            : `Brand kit extracted but not saved: ${payload.persistence.warning}`,
      });
      pushLiveEvent(
        payload.persistence.status === "persisted"
          ? `Extracted and saved brand kit for ${payload.brandKit.identity.businessName}.`
          : `Extracted ${payload.brandKit.identity.businessName}, but persistence failed: ${payload.persistence.warning}`,
      );
      setActiveTab("Brand Kit");
    } catch (error) {
      setLiveStatus({ tone: "rose", text: getErrorMessage(error) });
      pushLiveEvent(`Brand extraction failed: ${getErrorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function approveLiveBrandKit() {
    setIsBusy(true);
    setLiveStatus({ tone: "blue", text: "Approving brand kit..." });
    pushLiveEvent(`Approving brand kit for ${brandKit.identity.businessName}...`);

    try {
      const payload = await requestJson<{ brandKit: AdStudioBrandKit; persistence: AdStudioPersistenceStatus }>(
        `/api/adstudio/brand-kits/${brandKit.brandKitId}/approve`,
        { brandKit },
      );
      setBrandKit(payload.brandKit);
      setLiveStatus({
        tone: payload.persistence.status === "persisted" ? "green" : "amber",
        text:
          payload.persistence.status === "persisted"
            ? "Brand kit approved, locked, and saved for generation."
            : `Brand kit approved for this session but not saved: ${payload.persistence.warning}`,
      });
      pushLiveEvent(
        payload.persistence.status === "persisted"
          ? `Approved and saved brand kit ${payload.brandKit.brandKitId}.`
          : `Approved brand kit for this session; persistence failed: ${payload.persistence.warning}`,
      );
    } catch (error) {
      setLiveStatus({ tone: "rose", text: getErrorMessage(error) });
      pushLiveEvent(`Brand approval failed: ${getErrorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function generateLiveCampaign() {
    if (brandKit.reviewStatus !== "approved") {
      setLiveStatus({ tone: "rose", text: "Approve the brand kit before generating campaign variants." });
      setActiveTab("Brand Kit");
      return;
    }

    setIsBusy(true);
    setLiveStatus({ tone: "blue", text: "Generating campaign variants..." });
    pushLiveEvent(`Generating seller-lead variants for ${suburb.trim() || "Scarborough"}...`);

    try {
      const payload = await requestJson<{ campaignPack: AdStudioCampaignPack; persistence: AdStudioPersistenceStatus }>("/api/adstudio/campaigns", {
        brandKit,
        goal: "seller_leads",
        suburb: suburb.trim() || "Scarborough",
        city: "Perth",
        state: "WA",
        offerId: "seller_prep_checklist",
        platforms: ["meta", "google_search", "google_pmax", "google_demand_gen"],
        variantCount: 5,
      });
      setCampaignPack(payload.campaignPack);
      setCreatives(payload.campaignPack.creatives);
      setSelectedVariantId(payload.campaignPack.variants[0]?.variantId ?? "");
      setSelectedObjectId("headline");
      setLiveStatus({
        tone: payload.persistence.status === "persisted" ? "green" : "amber",
        text:
          payload.persistence.status === "persisted"
            ? "Generated 5 live campaign variants and saved the pack."
            : `Generated 5 variants for this session but did not save them: ${payload.persistence.warning}`,
      });
      pushLiveEvent(
        payload.persistence.status === "persisted"
          ? `Generated and saved ${payload.campaignPack.variants.length} variants for ${payload.campaignPack.campaign.market.suburb}.`
          : `Generated ${payload.campaignPack.variants.length} variants for this session; persistence failed: ${payload.persistence.warning}`,
      );
      setActiveTab("Variants");
    } catch (error) {
      setLiveStatus({ tone: "rose", text: getErrorMessage(error) });
      pushLiveEvent(`Campaign generation failed: ${getErrorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function downloadLiveExport() {
    setIsBusy(true);
    setLiveStatus({ tone: "blue", text: "Building export ZIP..." });
    pushLiveEvent(`Building ZIP for ${campaignPack.campaign.name}...`);

    try {
      const response = await fetch(`/api/adstudio/export-packages/${campaignPack.campaign.campaignId}/download`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignPack }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Export failed." }));
        throw new Error(payload.error ?? "Export failed.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${campaignPack.campaign.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-adstudio.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setLiveStatus({ tone: "green", text: "Export ZIP generated from the active campaign pack." });
      pushLiveEvent("Downloaded export ZIP with images, copy, CSV, follow-up, manifest, and compliance files.");
    } catch (error) {
      setLiveStatus({ tone: "rose", text: getErrorMessage(error) });
      pushLiveEvent(`Export failed: ${getErrorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function preparePublishPayload() {
    setIsBusy(true);
    setLiveStatus({ tone: "blue", text: "Preparing approval-gated publish payload..." });
    pushLiveEvent(`Preparing publish payload for ${campaignPack.campaign.name}...`);

    try {
      const payload = await requestJson<{
        publishReady: boolean;
        blockers: string[];
        metaPublishPlan?: { id?: string; approvalRequestId?: string | null } | null;
      }>(
        `/api/adstudio/export-packages/${campaignPack.campaign.campaignId}/publish`,
        { campaignPack },
      );
      setLastMetaPlanId(payload.metaPublishPlan?.id ?? null);
      setLiveStatus({
        tone: payload.publishReady ? "green" : "amber",
        text: payload.publishReady
          ? "Publish payload is ready."
          : `Publish payload prepared but blocked: ${payload.blockers.join(", ")}`,
      });
      pushLiveEvent(
        payload.publishReady
          ? `Publish payload is ready${payload.metaPublishPlan?.id ? ` as plan ${payload.metaPublishPlan.id}` : ""}.`
          : `Publish payload created but blocked: ${payload.blockers.join(", ")}`,
      );
    } catch (error) {
      setLiveStatus({ tone: "rose", text: getErrorMessage(error) });
      pushLiveEvent(`Publish payload preparation failed: ${getErrorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function requestMetaPlanMutation(action: "activate" | "pause" | "increase_budget") {
    if (!lastMetaPlanId) {
      setLiveStatus({ tone: "amber", text: "Prepare a Meta publish payload before requesting live changes." });
      setActiveTab("Export");
      return;
    }

    setIsBusy(true);
    setLiveStatus({ tone: "blue", text: "Creating approval request..." });

    try {
      const payload = await requestJson<{ approval?: { id?: string; risk_summary?: string } }>(
        `/api/integrations/meta/publish-plans/${lastMetaPlanId}/mutations`,
        {
          action,
          payload: {},
        },
      );
      setLiveStatus({ tone: "amber", text: "Approval request created for Meta live change." });
      pushLiveEvent(`Requested ${action.replace("_", " ")} approval${payload.approval?.id ? ` ${payload.approval.id}` : ""}.`);
    } catch (error) {
      setLiveStatus({ tone: "rose", text: getErrorMessage(error) });
      pushLiveEvent(`Meta live-change request failed: ${getErrorMessage(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <div className="adstudio-shell">
      <section className="panel adstudio-live-panel" id="adstudio-live-controls">
        <div>
          <p className="eyebrow">Live workflow</p>
          <h2>Extract, approve, generate, export</h2>
          <p className="item-meta">
            These controls call the production AdStudio APIs and persist generated records under the current workspace.
          </p>
        </div>
        <label>
          <span>Agency website</span>
          <input value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} placeholder="https://exampleagency.com.au" />
        </label>
        <label>
          <span>Suburb focus</span>
          <input value={suburb} onChange={(event) => setSuburb(event.target.value)} placeholder="Scarborough" />
        </label>
        <div className="adstudio-live-actions">
          <button className="button secondary" type="button" onClick={extractLiveBrandKit} disabled={isBusy}>
            <Sparkles aria-hidden size={17} />
            Extract brand
          </button>
          <button className="button secondary" type="button" onClick={approveLiveBrandKit} disabled={isBusy}>
            <ShieldCheck aria-hidden size={17} />
            Approve kit
          </button>
          <button className="button" type="button" onClick={generateLiveCampaign} disabled={isBusy}>
            <RefreshCw aria-hidden size={17} />
            Generate 5 variants
          </button>
          <button className="button secondary" type="button" onClick={downloadLiveExport} disabled={isBusy}>
            <Download aria-hidden size={17} />
            Download ZIP
          </button>
        </div>
        <StatusPill tone={liveStatus.tone}>{liveStatus.text}</StatusPill>
        <div className="adstudio-live-log" aria-label="AdStudio live activity">
          {liveEvents.map((event) => (
            <p key={event}>{event}</p>
          ))}
        </div>
      </section>

      <nav className="adstudio-tabs" aria-label="Ad Studio sections">
        {TABS.map((tab) => (
          <button
            className={tab === activeTab ? "active" : ""}
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </nav>

      {activeTab === "Dashboard" ? (
        <section className="adstudio-section">
          <div className="grid cols-4">
            {metricCards.map((metric) => {
              const Icon = metric.icon;

              return (
                <article className="metric-card" key={metric.label}>
                  <div className="metric-label">
                    <span>{metric.label}</span>
                    <Icon aria-hidden size={18} />
                  </div>
                  <div className="metric-value">{metric.value}</div>
                  <p className="metric-note">{metric.note}</p>
                </article>
              );
            })}
          </div>
          <div className="adstudio-dashboard">
            <section className="panel adstudio-primary-action">
              <div>
                <p className="eyebrow">Guided generation</p>
                <h2>Seller lead campaign pack</h2>
                <p className="item-meta">
                  Paste a website, approve the brand kit, choose the seller checklist offer, edit the strongest variant, and export platform-ready files.
                </p>
              </div>
              <button className="button" type="button" onClick={() => setActiveTab("Brand Kit")}>
                <Sparkles aria-hidden size={18} />
                Start workflow
              </button>
            </section>
            <section className="panel">
              <h2>Recent campaign work</h2>
              <table className="table">
                <thead>
                  <tr>
                    <th>Campaign</th>
                    <th>Goal</th>
                    <th>Offer</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{campaignPack.campaign.name}</td>
                    <td>{campaignPack.campaign.goal}</td>
                    <td>{selectedVariant?.offer}</td>
                    <td>
                      <StatusPill tone="green">ready</StatusPill>
                    </td>
                  </tr>
                </tbody>
              </table>
            </section>
          </div>
        </section>
      ) : null}

      {activeTab === "Brand Kit" ? (
        <section className="adstudio-section adstudio-brand-grid">
          <BrandPanel title="Logo" status={brandKit.logos.primaryLogoUrl ? "Accepted" : "Needs upload"}>
            <div className="adstudio-logo-preview">{brandKit.identity.businessName.slice(0, 2).toUpperCase()}</div>
            <p>{brandKit.logos.primaryLogoUrl ?? "Upload a primary logo"}</p>
          </BrandPanel>
          <BrandPanel title="Colours" status="Locked">
            <div className="adstudio-swatches">
              {[brandKit.colours.primary, brandKit.colours.secondary, brandKit.colours.accent, brandKit.colours.text].map((colour) => (
                <span style={{ background: colour }} key={colour} title={colour} />
              ))}
            </div>
          </BrandPanel>
          <BrandPanel title="Fonts" status="Accepted">
            <p>{brandKit.typography.headingFont} headings</p>
            <p>{brandKit.typography.bodyFont} body</p>
          </BrandPanel>
          <BrandPanel title="Voice" status="Accepted">
            <p>{brandKit.tone.voice}</p>
            <p>Avoid: {brandKit.tone.avoid.join(", ")}</p>
          </BrandPanel>
          <BrandPanel title="Compliance" status={brandKit.compliance.disclaimers.length ? "Accepted" : "Needs review"}>
            {brandKit.compliance.disclaimers.map((disclaimer) => (
              <p key={disclaimer}>{disclaimer}</p>
            ))}
          </BrandPanel>
          <BrandPanel title="Review locks" status="Protected">
            {brandKit.lockedFields.map((field) => (
              <p key={field}>
                <Lock aria-hidden size={14} /> {field}
              </p>
            ))}
          </BrandPanel>
        </section>
      ) : null}

      {activeTab === "Brief" ? (
        <section className="adstudio-section adstudio-brief">
          <div className="panel">
            <h2>Campaign Brief</h2>
            <div className="adstudio-form-grid">
              {[
                ["Campaign goal", "Seller leads"],
                ["Market", `${campaignPack.campaign.market.city}, ${campaignPack.campaign.market.state}`],
                ["Suburb focus", campaignPack.campaign.market.suburb],
                ["Audience intent", "Thinking of selling in the next 3 to 12 months"],
                ["Offer type", selectedVariant?.offer ?? "Seller checklist"],
                ["Tone", "Direct, premium, helpful"],
              ].map(([label, value]) => (
                <label key={label}>
                  <span>{label}</span>
                  <input readOnly value={value} />
                </label>
              ))}
            </div>
          </div>
          <aside className="panel adstudio-preview-card">
            <span className="status blue">Step 1 of 5</span>
            <h2>{campaignPack.campaign.name}</h2>
            <p>{campaignPack.campaign.audienceIntent}</p>
            <p className="item-meta">Strategy modules stay hidden unless advanced controls are enabled.</p>
            <label className="adstudio-toggle">
              <input type="checkbox" checked={advanced} onChange={(event) => setAdvanced(event.target.checked)} />
              <span>Advanced controls</span>
            </label>
          </aside>
        </section>
      ) : null}

      {activeTab === "Offers" ? (
        <section className="adstudio-section">
          <div className="adstudio-offer-grid">
            {offers.slice(0, 8).map((offer) => (
              <article className="item-card adstudio-offer-card" key={offer.offerId}>
                <StatusPill tone={offer.offerId === campaignPack.campaign.offerId ? "green" : "blue"}>
                  {offer.offerId === campaignPack.campaign.offerId ? "Recommended" : offer.goal}
                </StatusPill>
                <h3>{offer.name}</h3>
                <p className="item-meta">{offer.expectedLeadIntent}</p>
                <button className="button secondary" type="button" onClick={() => setActiveTab("Variants")}>
                  Use offer
                </button>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "Variants" ? (
        <section className="adstudio-section adstudio-variant-layout">
          <aside className="panel">
            <h2>Locked inputs</h2>
            <p className="item-meta">Goal: {campaignPack.campaign.goal}</p>
            <p className="item-meta">Market: {campaignPack.campaign.market.suburb}</p>
            <p className="item-meta">Platforms: {campaignPack.campaign.platforms.join(", ")}</p>
          </aside>
          <div className="adstudio-variant-grid">
            {campaignPack.variants.map((variant) => (
              <button
                className={`adstudio-variant-card ${variant.variantId === selectedVariantId ? "active" : ""}`}
                key={variant.variantId}
                type="button"
                onClick={() => setSelectedVariantId(variant.variantId)}
              >
                <div className="adstudio-thumb">
                  <strong>{variant.headline}</strong>
                </div>
                <span className="status green">{variant.score.score}</span>
                <h3>{variant.angle}</h3>
                <p>{variant.cta}</p>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === "Editor" ? (
        <section className="adstudio-section adstudio-editor">
          <aside className="panel adstudio-tool-panel">
            <h2>Layers</h2>
            {selectedCreative?.canvas.objects.map((object) => (
              <button
                className={object.objectId === selectedObjectId ? "active" : ""}
                key={object.objectId}
                type="button"
                onClick={() => setSelectedObjectId(object.objectId)}
              >
                <Layers aria-hidden size={15} />
                {object.role}
                {object.locked ? <Lock aria-hidden size={14} /> : null}
              </button>
            ))}
            <h2>Ratios</h2>
            <div className="adstudio-ratio-row">
              {FORMATS.map((format) => (
                <button className={format === selectedFormat ? "active" : ""} key={format} type="button" onClick={() => setSelectedFormat(format)}>
                  {format}
                </button>
              ))}
            </div>
          </aside>

          <div className="panel adstudio-canvas-panel">
            <div className="adstudio-editor-bar">
              <div>
                <MousePointer2 aria-hidden size={16} />
                <span>Safe zones visible</span>
              </div>
              <StatusPill tone="green">Compliant</StatusPill>
            </div>
            {selectedCreative ? (
              <EditableCanvas
                creative={selectedCreative}
                selectedObjectId={selectedObjectId}
                onSelect={setSelectedObjectId}
                onMove={moveSelectedObject}
              />
            ) : null}
          </div>

          <aside className="panel adstudio-tool-panel">
            <h2>Properties</h2>
            {selectedObject ? (
              <ObjectControls object={selectedObject} onChange={updateSelectedObject} />
            ) : (
              <p className="item-meta">Select an object to edit it.</p>
            )}
            {advanced ? (
              <div className="adstudio-advanced">
                <h3>Power controls</h3>
                <p className="item-meta">Provider: deterministic_local</p>
                <p className="item-meta">Seed: 27</p>
                <button className="button secondary" type="button">
                  <RefreshCw aria-hidden size={16} />
                  Regenerate selected
                </button>
              </div>
            ) : null}
          </aside>
        </section>
      ) : null}

      {activeTab === "Copy Pack" && selectedCopy ? (
        <section className="adstudio-section adstudio-copy-layout">
          <div className="panel">
            <div className="adstudio-copy-tabs">
              <span>Meta</span>
              <span>Google Search</span>
              <span>PMax</span>
              <span>Follow-up</span>
            </div>
            <CopyBlock title="Meta primary text" text={selectedCopy.meta.primaryText.join("\n\n")} />
            <CopyBlock title="Google Search headlines" text={selectedCopy.googleSearch.headlines.join(" | ")} />
            <CopyBlock title="Landing page" text={`${selectedCopy.landingPage.headline}\n${selectedCopy.landingPage.subheadline}`} />
          </div>
          <aside className="panel">
            <h2>Lead form preview</h2>
            {selectedCopy.meta.leadForm.questions.map((question, index) => (
              <div className="adstudio-question" key={question}>
                <span>Question {index + 1}</span>
                <strong>{question}</strong>
              </div>
            ))}
          </aside>
        </section>
      ) : null}

      {activeTab === "Compliance" ? (
        <section className="adstudio-section adstudio-compliance">
          <div className="panel">
            <h2>Compliance Review</h2>
            <StatusPill tone={campaignPack.compliance.status === "approved" ? "green" : "rose"}>
              {campaignPack.compliance.status}
            </StatusPill>
            {campaignPack.compliance.issues.length === 0 ? (
              <div className="adstudio-checklist">
                {[
                  "Meta housing category set",
                  "No discriminatory audience wording",
                  "No guaranteed sale price claim",
                  "Privacy policy provided",
                  "Platform limits checked",
                ].map((item) => (
                  <p key={item}>
                    <BadgeCheck aria-hidden size={17} />
                    {item}
                  </p>
                ))}
              </div>
            ) : (
              campaignPack.compliance.issues.map((issue) => <p key={issue.code}>{issue.message}</p>)
            )}
          </div>
        </section>
      ) : null}

      {activeTab === "Export" ? (
        <section className="adstudio-section adstudio-export">
          <div className="panel">
            <h2>Export contents</h2>
            <table className="table">
              <tbody>
                {[
                  ["Creative images", "Meta, Google PMax, Demand Gen ratios"],
                  ["Meta ad copy", "Primary text, headline, description, lead form"],
                  ["Google Search CSV", "Responsive Search Ad fields and keywords"],
                  ["Compliance report", "JSON and PDF"],
                  ["Follow-up sequence", "SMS and email"],
                ].map(([name, detail]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{detail}</td>
                    <td>
                      <StatusPill tone="green">ready</StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <aside className="panel adstudio-download-panel">
            <Download aria-hidden size={28} />
            <h2>Campaign pack ready</h2>
            <p className="item-meta">Download ZIP, prepare approval link, or prepare provider payloads after approval.</p>
            <button className="button" type="button" onClick={downloadLiveExport} disabled={isBusy}>
              Download ZIP
            </button>
            <button className="button secondary" type="button" onClick={preparePublishPayload} disabled={isBusy}>
              Prepare publish payload
            </button>
            <button className="button secondary" type="button" onClick={() => void requestMetaPlanMutation("activate")} disabled={isBusy || !lastMetaPlanId}>
              Request activation
            </button>
            <button className="button secondary" type="button" onClick={() => void requestMetaPlanMutation("pause")} disabled={isBusy || !lastMetaPlanId}>
              Request pause
            </button>
            <button className="button secondary" type="button" onClick={() => void requestMetaPlanMutation("increase_budget")} disabled={isBusy || !lastMetaPlanId}>
              Request budget
            </button>
          </aside>
        </section>
      ) : null}

      {activeTab === "Performance" ? (
        <section className="adstudio-section">
          <div className="grid cols-4">
            <article className="metric-card">
              <div className="metric-label">
                <span>Leads</span>
                <Megaphone aria-hidden size={18} />
              </div>
              <div className="metric-value">{performance.leads}</div>
              <p className="metric-note">Imported from provider reports</p>
            </article>
            <article className="metric-card">
              <div className="metric-label">
                <span>CPL</span>
                <ClipboardCheck aria-hidden size={18} />
              </div>
              <div className="metric-value">${performance.costPerLeadAud}</div>
              <p className="metric-note">Target under $25</p>
            </article>
            <article className="metric-card">
              <div className="metric-label">
                <span>Bookings</span>
                <FileText aria-hidden size={18} />
              </div>
              <div className="metric-value">{performance.bookedAppraisals}</div>
              <p className="metric-note">Lead-to-booking feedback</p>
            </article>
            <article className="metric-card">
              <div className="metric-label">
                <span>Best format</span>
                <Image aria-hidden size={18} />
              </div>
              <div className="metric-value">{performance.bestFormat}</div>
              <p className="metric-note">Feeds next generation run</p>
            </article>
          </div>
          <section className="panel">
            <h2>Recommended next variants</h2>
            {performance.recommendations.map((recommendation) => (
              <p className="adstudio-recommendation" key={recommendation}>
                <Sparkles aria-hidden size={17} />
                {recommendation}
              </p>
            ))}
          </section>
        </section>
      ) : null}
    </div>
  );
}

async function requestJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(payload?.error ?? `Request failed with ${response.status}.`);
  }

  return payload as T;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "AdStudio live request failed.";
}

function BrandPanel({ title, status, children }: { title: string; status: string; children: React.ReactNode }) {
  return (
    <article className="panel adstudio-brand-panel">
      <div className="section-heading">
        <h2>{title}</h2>
        <StatusPill tone={status.includes("Needs") ? "amber" : "green"}>{status}</StatusPill>
      </div>
      {children}
      <div className="actions">
        <button className="button secondary" type="button">Edit</button>
        <button className="button secondary" type="button">Lock</button>
      </div>
    </article>
  );
}

function EditableCanvas({
  creative,
  selectedObjectId,
  onSelect,
  onMove,
}: {
  creative: AdStudioCreative;
  selectedObjectId: string;
  onSelect: (objectId: string) => void;
  onMove: (deltaX: number, deltaY: number) => void;
}) {
  const scale = useMemo(() => Math.min(1, 520 / creative.canvas.height, 520 / creative.canvas.width), [creative]);

  return (
    <div className="adstudio-canvas-wrap">
      <div
        className="adstudio-canvas"
        style={{
          width: creative.canvas.width * scale,
          height: creative.canvas.height * scale,
        }}
      >
        {creative.canvas.objects.map((object) => (
          <button
            className={`adstudio-canvas-object ${object.type} ${object.objectId === selectedObjectId ? "selected" : ""}`}
            key={object.objectId}
            type="button"
            style={{
              left: object.x * scale,
              top: object.y * scale,
              width: object.width * scale,
              height: (object.height ?? 80) * scale,
              background: object.type === "shape" ? object.fill : undefined,
              color: object.fill && object.fill === "#FFFFFF" ? "#18201f" : object.fill,
              fontSize: (object.size ?? 28) * scale,
            }}
            onClick={() => onSelect(object.objectId)}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft") onMove(-12, 0);
              if (event.key === "ArrowRight") onMove(12, 0);
              if (event.key === "ArrowUp") onMove(0, -12);
              if (event.key === "ArrowDown") onMove(0, 12);
            }}
          >
            {object.type === "text" || object.role === "cta_text" ? object.content : null}
            {object.type === "logo" ? "BRAND" : null}
            {object.type === "image" ? "" : null}
          </button>
        ))}
      </div>
    </div>
  );
}

function ObjectControls({
  object,
  onChange,
}: {
  object: AdStudioCanvasObject;
  onChange: (patch: Partial<AdStudioCanvasObject>) => void;
}) {
  return (
    <div className="adstudio-object-controls">
      <label>
        <span>Content</span>
        <textarea
          disabled={object.locked}
          value={object.content ?? ""}
          onChange={(event) => onChange({ content: event.target.value })}
        />
      </label>
      <div className="adstudio-stepper-row">
        <button type="button" onClick={() => onChange({ x: Math.max(0, object.x - 16) })} disabled={object.locked}>Left</button>
        <button type="button" onClick={() => onChange({ x: object.x + 16 })} disabled={object.locked}>Right</button>
        <button type="button" onClick={() => onChange({ y: Math.max(0, object.y - 16) })} disabled={object.locked}>Up</button>
        <button type="button" onClick={() => onChange({ y: object.y + 16 })} disabled={object.locked}>Down</button>
      </div>
      <label>
        <span>Size</span>
        <input
          type="range"
          min="18"
          max="92"
          value={object.size ?? 32}
          disabled={object.locked}
          onChange={(event) => onChange({ size: Number(event.target.value) })}
        />
      </label>
      <button className="button secondary" type="button" onClick={() => onChange({ locked: !object.locked })}>
        {object.locked ? <Unlock aria-hidden size={16} /> : <Lock aria-hidden size={16} />}
        {object.locked ? "Unlock" : "Lock"}
      </button>
    </div>
  );
}

function CopyBlock({ title, text }: { title: string; text: string }) {
  return (
    <article className="adstudio-copy-block">
      <div>
        <h3>{title}</h3>
        <span>{text.length} chars</span>
      </div>
      <p>{text}</p>
      <div className="actions">
        <button className="button secondary" type="button">Shorten</button>
        <button className="button secondary" type="button">Make local</button>
        <button className="button secondary" type="button">Lock</button>
      </div>
    </article>
  );
}
