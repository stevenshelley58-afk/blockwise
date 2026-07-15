import type { Metadata } from "next";

import { HomeLanding } from "@/components/home-landing/home-landing";

import "./homepage.css";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return <HomeLanding />;
}
