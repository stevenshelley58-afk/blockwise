import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { HomeDashboard, type HomeData } from "../src/components/self-serve/home-dashboard.tsx";
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
    localAds: [],
    localAdsArea: null,
    activation: {
      currentStage: "brand",
      nextAction: "brand",
      resumePath: "/ad-studio/brand",
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
  const html = renderToStaticMarkup(
    createElement(
      HomeDashboard,
      { data: homeData({ localAds: ads, localAdsArea: { place: "Scarborough", searchTerm: "6019" } }) },
    ),
  );

  // The heading names the area the ads were read for, and View all carries it.
  assert.match(html, /Ads near Scarborough/);
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

test("an empty local-ads list leaves no heading behind", () => {
  const html = renderToStaticMarkup(createElement(HomeDashboard, { data: homeData() }));

  assert.doesNotMatch(html, /Ads near/);
  assert.doesNotMatch(html, /lg:grid-cols-4/);
});
