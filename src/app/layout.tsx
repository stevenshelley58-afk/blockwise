import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Blockwise",
  description: "Real estate lead generation control plane for Monitor, Self-Serve, and operator workflows.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
