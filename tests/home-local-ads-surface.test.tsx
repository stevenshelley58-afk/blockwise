import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

import { HomeDashboard, type HomeData } from "../src/components/ad-studio/home-dashboard.tsx";
import type { HomeLocalAd } from "../src/lib/home/home-local-ads.ts";

function localAd(overrides: Partial<HomeLocalAd> & { id: string }): HomeLocalAd {
  return {
    pageName: "Northstar Realty",
    headline: "Book a local appraisal",
    imageUrl: "https://cdn.example/ad.jpg",
    suburb: "Scarborough",
    state: "WA",
    activeStatus: "active",
    startedAt: "2026-08-01T00:00:00.000Z",
    stoppedAt: null,
    adType: "image",
    media: [{ kind: "image", url: "https://cdn.example/ad.jpg", posterUrl: null }],
    ...overrides,
  };
}

function homeData(overrides: Partial<HomeData> = {}): HomeData {
  return {
    workspaceName: "West Coast Home Co",
    hasBrand: true,
    hasProvider: false,
    ads: { created: 0, live: null, publishedThisWeek: 0 },
    performance: null,
    leads: [],
    leadsAreExamples: false,
    defaultPostcode: null,
    canManageLocation: true,
    localAdsStatus: "missing",
    localAds: [],
    localAdsArea: null,
    activation: {
      currentStage: "brand",
      nextAction: "brand",
      resumePath: "/ad-builder/brand",
      completed: 1,
      total: 3,
      milestones: {},
      foundationAvailable: true,
    },
    credits: {
      granted: 10,
      used: 0,
      reserved: 0,
      remaining: 10,
      entitlementType: "trial",
      periodStart: null,
      periodEnd: null,
    },
    plan: {
      accessState: "trialing",
      currency: "AUD",
      periodEnd: null,
      cancelAtPeriodEnd: false,
      latestInvoiceStatus: null,
    },
    meta: { state: "not_connected", accountName: null },
    booking: { state: "not_booked" },
    ...overrides,
  } as HomeData;
}

function renderHome(data: HomeData) {
  const router = {
    back() {},
    forward() {},
    refresh() {},
    push() {},
    replace() {},
    prefetch() { return Promise.resolve(); },
  };
  return renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: router as never },
      createElement(HomeDashboard, { data, workspaceId: "workspace-1" }),
    ),
  );
}

test("local ads read as rows on a phone and as Ad Radar cards on desktop", () => {
  const ads = [
    localAd({
      id: "ad-1",
      pageName: "Northstar Realty",
      media: [
        { kind: "image", url: "https://cdn.example/ad.jpg", posterUrl: null },
        { kind: "image", url: "https://cdn.example/ad-2.jpg", posterUrl: null },
      ],
    }),
    localAd({
      id: "ad-2",
      pageName: "Harbour Realty",
      headline: "What's your home worth?",
      imageUrl: "https://cdn.example/two.jpg",
      media: [{ kind: "video", url: "https://cdn.example/two.mp4", posterUrl: "https://cdn.example/two.jpg" }],
    }),
  ];
  const html = renderHome(homeData({ defaultPostcode: "6019", localAdsStatus: "ready", localAds: ads, localAdsArea: { place: "Scarborough", searchTerm: "6019" } }));

  // The heading is Home's own, and View all carries the area the ads were read for.
  assert.match(html, /Ads near you/);
  assert.match(html, /\/ad-radar\?q=6019/);

  // Both treatments are in the markup, each behind its own breakpoint: the list
  // on a phone, the card grid from `lg` where there is width for a picture.
  assert.match(html, /lg:hidden/);
  assert.match(html, /lg:grid-cols-4/);

  for (const ad of ads) {
    assert.match(html, new RegExp(`href="/ad-radar/ads/${ad.id}"`));
    assert.match(html, new RegExp(ad.imageUrl.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")));
    assert.match(html, new RegExp(ad.pageName));
  }

  // The card says what the ad is, the way Ad Radar's does.
  assert.match(html, /Carousel/);
  assert.match(html, /· Video/);
  // Every ad here has a checked still, so nothing claims a missing preview.
  assert.doesNotMatch(html, /Preview unavailable/);
  assert.doesNotMatch(html, />Ad</);
});

test("a manager with no postcode gets the inline capture instead of fabricated ads", () => {
  const html = renderHome(homeData());

  assert.match(html, /Ads near you/);
  assert.match(html, /Default postcode/);
  assert.match(html, /Show local ads/);
  assert.doesNotMatch(html, /lg:grid-cols-4/);
});

test("a non-manager with no postcode is told who can set the workspace default", () => {
  const html = renderHome(homeData({ canManageLocation: false }));

  assert.match(html, /Ask a workspace owner or admin/);
  assert.doesNotMatch(html, /Show local ads/);
});

test("an empty structured read stays visible and truthful", () => {
  const html = renderHome(homeData({
      defaultPostcode: "6019",
      localAdsStatus: "empty",
      localAdsArea: { place: "Scarborough", searchTerm: "6019" },
    }));

  assert.match(html, /No local ad previews are available/);
  assert.match(html, /\/ad-radar\?q=6019/);
});

test("a failed postcode read shows recovery instead of looking like missing data", () => {
  const html = renderHome(homeData({ localAdsStatus: "error" }));

  assert.match(html, /could not be loaded/);
  assert.match(html, /Refresh the page/);
});
