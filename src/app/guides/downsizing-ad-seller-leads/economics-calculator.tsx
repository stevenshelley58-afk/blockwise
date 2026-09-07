"use client";

import { useMemo, useState } from "react";

type Funnel = {
  spend: number;
  leads: number;
  validContacts: number;
  homeowners: number;
  sellerConversations: number;
  appraisals: number;
  listings: number;
};

const initial: Funnel = {
  spend: 280,
  leads: 20,
  validContacts: 14,
  homeowners: 8,
  sellerConversations: 5,
  appraisals: 2,
  listings: 1,
};

const stages: Array<[keyof Funnel, string]> = [
  ["leads", "Leads"],
  ["validContacts", "Valid contacts"],
  ["homeowners", "Existing homeowners"],
  ["sellerConversations", "Seller conversations"],
  ["appraisals", "Appraisals"],
  ["listings", "Listings"],
];

function numberValue(value: string) {
  return Number(value);
}

export function DownsizingEconomicsCalculator() {
  const [inputs, setInputs] = useState<Record<keyof Funnel, string>>(() =>
    Object.fromEntries(Object.entries(initial).map(([key, value]) => [key, String(value)])) as Record<keyof Funnel, string>,
  );
  const funnel = useMemo(() => Object.fromEntries(
    Object.entries(inputs).map(([key, value]) => [key, numberValue(value)]),
  ) as Funnel, [inputs]);

  const validation = useMemo(() => {
    if (Object.values(inputs).some(value => value.trim() === "")) return "Enter a number in every field; use 0 when there are none.";
    if (!Number.isFinite(funnel.spend) || funnel.spend < 0) return "Spend must be zero or more.";
    for (const [key] of stages) {
      const value = funnel[key];
      if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value) || !Number.isSafeInteger(value)) {
        return "Counts must be whole numbers of zero or more.";
      }
    }
    for (let index = 1; index < stages.length; index += 1) {
      if (funnel[stages[index][0]] > funnel[stages[index - 1][0]]) {
        return `${stages[index][1]} cannot be greater than ${stages[index - 1][1].toLowerCase()}.`;
      }
    }
    return null;
  }, [funnel, inputs]);

  const results = useMemo(() => {
    if (validation) return null;
    return stages.map(([key, label], index) => {
      const count = funnel[key];
      const denominator = index === 0 ? undefined : funnel[stages[index - 1][0]];
      const rate = denominator && denominator > 0 ? (count / denominator) * 100 : undefined;
      const cost = count > 0 ? funnel.spend / count : undefined;
      return { key, label, count, rate, cost };
    });
  }, [funnel, validation]);

  function update(key: keyof Funnel, value: string) {
    setInputs((current) => ({ ...current, [key]: value }));
  }

  return (
    <section className="bw-campaign-settings" aria-labelledby="economics-calculator-title">
      <div className="bw-section-heading">
        <span>Use your own numbers</span>
        <h2 id="economics-calculator-title">Downsizer campaign economics</h2>
        <p>Nothing is sent anywhere. Enter observed counts to see stage rates and cost per stage. The starting numbers are fictional, not forecasts. Count one cohort through these sequential stages; do not mix independent totals.</p>
      </div>
      <div className="bw-calculator-fields">
        <label>Spend (A$)<input type="number" min="0" step="0.01" value={inputs.spend} onChange={(event) => update("spend", event.target.value)} /></label>
        {stages.map(([key, label]) => (
          <label key={key}>{label}<input type="number" min="0" step="1" value={inputs[key]} onChange={(event) => update(key, event.target.value)} /></label>
        ))}
      </div>
      {validation ? <p role="alert" className="bw-article-note">{validation}</p> : (
        <div className="bw-measure-table" role="table" aria-label="Campaign funnel economics">
          <div role="row" className="bw-measure-head"><span role="columnheader">Stage</span><span role="columnheader">Count</span><span role="columnheader">Stage rate</span><span role="columnheader">Cost per stage</span></div>
          {results?.map((result) => (
            <div role="row" key={result.key}><strong role="cell">{result.label}</strong><span role="cell">{result.count}</span><span role="cell">{result.rate === undefined ? "—" : `${result.rate.toFixed(1)}%`}</span><span role="cell">{result.cost === undefined ? "—" : `A$${result.cost.toFixed(2)}`}</span></div>
          ))}
          <p className="bw-article-note">Lead-to-listing rate: {funnel.leads > 0 ? `${((funnel.listings / funnel.leads) * 100).toFixed(1)}%` : "—"}. Cost per listing: {funnel.listings > 0 ? `A$${(funnel.spend / funnel.listings).toFixed(2)}` : "—"}.</p>
        </div>
      )}
    </section>
  );
}
