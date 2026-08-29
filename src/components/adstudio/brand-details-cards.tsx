"use client";

import type { AdStudioBrandKit } from "@/lib/adstudio";

type BrandIdentity = AdStudioBrandKit["identity"];
type BrandContact = AdStudioBrandKit["contact"];

/* ------------------------------------------------------------------ */
/* identity & contact + compliance cards                               */
/* ------------------------------------------------------------------ */

export function BrandDetailsCards({
  identity,
  contact,
  disclaimers,
  onIdentityChange,
  onContactChange,
  onDisclaimerChange,
  onAddDisclaimer,
}: {
  identity: BrandIdentity;
  contact: BrandContact;
  disclaimers: string[];
  onIdentityChange: <K extends keyof BrandIdentity>(key: K, value: BrandIdentity[K]) => void;
  onContactChange: <K extends keyof BrandContact>(key: K, value: BrandContact[K]) => void;
  onDisclaimerChange: (index: number, value: string) => void;
  onAddDisclaimer: () => void;
}) {
  return (
    <div className="bs-two">
      <section className="bs-card">
        <h3>Identity &amp; contact</h3>
        <div className="bs-kv">
          <div className="r">
            <span>Agency</span>
            <input value={identity.businessName} onChange={(e) => onIdentityChange("businessName", e.target.value)} />
          </div>
          <div className="r">
            <span>Agent</span>
            <input value={identity.tradingName ?? ""} onChange={(e) => onIdentityChange("tradingName", e.target.value)} />
          </div>
          <div className="r">
            <span>Phone</span>
            <input value={contact.phone ?? ""} onChange={(e) => onContactChange("phone", e.target.value)} />
          </div>
          <div className="r">
            <span>Email</span>
            <input value={contact.email ?? ""} onChange={(e) => onContactChange("email", e.target.value)} />
          </div>
          <div className="r">
            <span>Region</span>
            <input value={identity.marketRegion ?? ""} onChange={(e) => onIdentityChange("marketRegion", e.target.value)} />
          </div>
          <div className="r">
            <span>Licence</span>
            <input value={identity.licenceText ?? ""} onChange={(e) => onIdentityChange("licenceText", e.target.value)} />
          </div>
        </div>
      </section>
      <section className="bs-card">
        <h3>Compliance</h3>
        <div className="bs-disc">
          {disclaimers.map((disclaimer, index) => (
            <textarea
              key={index}
              rows={2}
              value={disclaimer}
              onChange={(event) => onDisclaimerChange(index, event.target.value)}
            />
          ))}
          <button type="button" className="add" onClick={onAddDisclaimer}>
            ＋ Add disclaimer
          </button>
        </div>
      </section>
    </div>
  );
}
