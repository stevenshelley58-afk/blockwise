import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { niche } from "@/config/niche";
import {
  HeroBoundaryDraw,
  HeroCinematic,
  HeroDepthField,
  HeroNightOps,
  HeroRadarSweep,
} from "@/components/hero-lab/heroes";

import "@/components/hero-lab/hero-lab.css";

export const metadata: Metadata = {
  title: "Hero Lab",
  robots: { index: false, follow: false },
};

const VARIANTS = [
  {
    id: "01",
    name: "Radar Sweep",
    note: "conic beam · pulsing rings · staggered type",
    Node: HeroRadarSweep,
  },
  {
    id: "02",
    name: "Boundary Draw",
    note: "SVG path draw · spring pins · count-up proof",
    Node: HeroBoundaryDraw,
  },
  {
    id: "03",
    name: "Night Ops",
    note: "dark map · looping boundary draw · glass metric cards",
    Node: HeroNightOps,
  },
  {
    id: "04",
    name: "Depth Field",
    note: "pointer parallax · layered boundary & pins",
    Node: HeroDepthField,
  },
  {
    id: "05",
    name: "Cinematic",
    note: "Ken Burns zoom · mask-reveal headline",
    Node: HeroCinematic,
  },
] as const;

export default function HeroLabPage() {
  if (!niche.features.suburbPages) notFound();

  return (
    <div className="hl-lab">
      <header className="hl-lab-intro">
        <p className="hl-lab-kicker">Blockwise · hero exploration</p>
        <h1>Five hero directions, one map.</h1>
        <p>
          Each variant uses the suburb map as the hero surface and keeps the
          live suburb search working end-to-end. Scroll through, then pick a
          direction to ship.
        </p>
      </header>

      {VARIANTS.map(({ id, name, note, Node }) => (
        <div className="hl-lab-item" key={id}>
          <span className="hl-lab-label">
            <b>{id}</b>
            {name}
            <small>· {note}</small>
          </span>
          <Node />
        </div>
      ))}

      <footer className="hl-lab-foot">
        Maps are illustrative. Suburb search is live and routes to the real
        report. <Link href="/">← Back to the current homepage</Link>
      </footer>
    </div>
  );
}
