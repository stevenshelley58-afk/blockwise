import type { Metadata } from "next";

import { HomeLanding } from "@/components/landing/home-landing";

import "./home-redesign.css";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/**
 * Blockwise homepage — "local signal -> leads" redesign.
 * Server wrapper that owns metadata and renders the client landing component
 * (src/components/landing/home-landing.tsx). Styling is scoped under `.bwx`
 * in ./home-redesign.css so it cannot collide with global/app styles.
 */
export default function HomePage() {
  return <HomeLanding />;
}
